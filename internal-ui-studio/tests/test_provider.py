"""Network-free provider boundary tests."""
import base64
import json
import os
import socket
import struct
import unittest
from unittest.mock import patch
import zlib

import provider


BASE = "https://vision.example.com/api/v1"
TEST_KEY = "token-test-never-real"
MODEL = "fixture-vision"


def chat_payload(result, model=MODEL):
    return {"model":model, "choices":[{"finish_reason":"stop","message":{"content":json.dumps(result)}}]}


def decode_independently(uri):
    """Read actual RGB bytes from the synthetic challenge, not expected answer data."""
    assert uri.startswith("data:image/png;base64,")
    blob = base64.b64decode(uri.split(",",1)[1],validate=True)
    assert blob[:8] == b"\x89PNG\r\n\x1a\n"
    x, y, bits, colors, *_ = struct.unpack(">IIBBBBB",blob[16:29])
    assert bits==8 and colors==2
    pos=8; packed=b""
    while pos < len(blob):
        size,kind=struct.unpack_from(">I4s",blob,pos)
        if kind==b"IDAT":
            packed+=blob[pos+8:pos+8+size]
        pos+=size+12
    arr=zlib.decompress(packed)
    stride=x*3+1
    assert y*stride==len(arr) and not any(arr[::stride])
    def pix(px,py):
        at=py*stride+1+px*3
        return tuple(arr[at:at+3])
    # Independent fixed sample masks for these rendered primitive geometries.
    positions={"top_left":(36,36),"top_right":(108,36),"bottom_left":(36,108),"bottom_right":(108,108)}
    colors={(214,30,50):"red",(34,91,220):"blue",(8,135,68):"green",(239,176,16):"yellow"}
    def verify(px,py):
        fill=pix(px,py)
        if pix(px+15,py+15)==fill and pix(px+15,py-15)==fill:
            kind="square"
        elif pix(px+12,py+13)==fill and pix(px+12,py-13)!=fill:
            kind="triangle"
        elif pix(px+10,py+10)==fill:
            kind="circle"
        else:
            kind="diamond"
        return {"shape":kind,"color":colors[fill]}
    return {k:verify(*xy) for k,xy in positions.items()}


class ProviderTest(unittest.TestCase):
    def setUp(self):
        self.env=patch.dict(os.environ,{"F2_ALLOWED_AI_BASE_URLS":BASE})
        self.env.start()
        self.addCleanup(self.env.stop)

    def assertCode(self,code,callable,*args):
        with self.assertRaises(provider.ProviderError) as cm:
            callable(*args)
        self.assertEqual(cm.exception.code,code)
        self.assertNotIn(TEST_KEY,str(cm.exception))

    def test_config_only_exact_canonical_prefix(self):
        self.assertEqual(provider._approved_endpoint("https://VISION.example.com:443/api/v1/"),("vision.example.com",443,"/api/v1"))
        for u in (BASE+"/extra","https://vision.example.com:8443/api/v1",BASE+"?x=1",BASE+"#fragment",
                  "http://vision.example.com/api/v1","https://vision.example.com:0/api/v1",
                  "https://other.vision.example.com/api/v1","https://vision.example.com/api/%2e%2e",
                  "https://token-test-never-real@vision.example.com/api/v1"):
            self.assertCode("endpoint_not_allowed",provider.list_models,u,TEST_KEY)
        with patch.dict(os.environ,{"F2_ALLOWED_AI_BASE_URLS":""}):
            self.assertCode("endpoint_not_allowed",provider.list_models,BASE,TEST_KEY)

    def test_allowlist_cannot_enable_private_ip_or_private_dns(self):
        with patch.dict(os.environ,{"F2_ALLOWED_AI_BASE_URLS":"https://127.0.0.1/v1,https://[::1]/v1"}):
            self.assertCode("endpoint_not_allowed",provider.list_models,"https://127.0.0.1/v1",TEST_KEY)
            self.assertCode("endpoint_not_allowed",provider.list_models,"https://[::1]/v1",TEST_KEY)
        entries=[(socket.AF_INET,socket.SOCK_STREAM,0,'',("93.184.216.34",443)),
                 (socket.AF_INET,socket.SOCK_STREAM,0,'',("10.11.1.1",443))]
        with patch.object(provider.socket,"getaddrinfo",return_value=entries):
            self.assertCode("endpoint_not_allowed",provider._public_address,"vision.example.com",443)
        with patch.object(provider.socket,"getaddrinfo",return_value=entries[:1]):
            self.assertEqual(provider._public_address("vision.example.com",443),(socket.AF_INET,("93.184.216.34",443)))

    def test_redirect_is_not_followed_body_is_not_read(self):
        with patch.object(provider,"_PinnedConnection") as factory:
            req=factory.return_value
            res=req.getresponse.return_value.__enter__.return_value
            res.status=302
            self.assertCode("upstream_rejected",provider.list_models,BASE,TEST_KEY)
            req.request.assert_called_once()
            m,path=req.request.call_args.args
            self.assertEqual((m,path),("GET","/api/v1/models"))
            self.assertEqual(req.request.call_args.kwargs["headers"]["Authorization"],"Bearer "+TEST_KEY)
            res.read1.assert_not_called()
            req.close.assert_called_once()

    def test_invalid_key_and_valid_model_listing(self):
        self.assertCode("invalid_key",provider.list_models,BASE,TEST_KEY+"\r\n X: y")
        with patch.object(provider,"_request_json",return_value={"data":[{"id":"vendor/z"},{"id":"alpha"},{"id":"vendor/z"}]}) as request:
            self.assertEqual(provider.list_models(BASE,TEST_KEY),["alpha","vendor/z"])
            request.assert_called_once_with(BASE,TEST_KEY,"GET","/models")

    def test_response_strict_size_and_error_redaction(self):
        with patch.object(provider,"_PinnedConnection") as factory:
            con=factory.return_value
            res=con.getresponse.return_value.__enter__.return_value
            res.status=200
            def headers(name,default=None):
                return {"Content-Length":"1048577"}.get(name,default)
            res.getheader.side_effect=headers
            self.assertCode("invalid_response",provider.list_models,BASE,TEST_KEY)
            res.read1.assert_not_called()
        with patch.object(provider,"_PinnedConnection") as factory:
            factory.return_value.request.side_effect=OSError(TEST_KEY)
            self.assertCode("connection_failed",provider.list_models,BASE,TEST_KEY)
            factory.return_value.request.side_effect=TimeoutError(TEST_KEY)
            self.assertCode("timed_out",provider.list_models,BASE,TEST_KEY)
        self.assertCode("invalid_response",provider._inbound_json,b'{"same":1,"same":2}')
        self.assertCode("invalid_response",provider._inbound_json,b'{"nan":NaN}')
        self.assertCode("invalid_response",provider._inbound_json,b'{"nan":1e999}')

    def test_randomized_probe_can_be_passed_only_with_pixel_derived_fields(self):
        observed=[]
        def answer(base,key,method,suffix,post):
            self.assertEqual((base,key,method,suffix),(BASE,TEST_KEY,"POST","/chat/completions"))
            self.assertEqual(post["model"],MODEL)
            self.assertEqual(post["response_format"],{"type":"json_object"})
            content=post["messages"][0]["content"]
            self.assertEqual([x["text"] for x in content if x["type"]=="text"][1:],["image_a","image_b"])
            left,right=(x["image_url"]["url"] for x in content if x["type"]=="image_url")
            observed.extend([left,right])
            return chat_payload({"image_a":decode_independently(left),"image_b":decode_independently(right)})
        with patch.object(provider,"_request_json",side_effect=answer) as request:
            for _ in range(3):
                self.assertEqual(provider.probe_vision(BASE,TEST_KEY,MODEL),{
                    "ok":True,"model":MODEL,"reported_model":MODEL,"vision":True,"probe":"hidden-shapes-v1"})
            self.assertEqual(request.call_count,3)
        self.assertGreater(len(set(observed)),2)

    def test_listing_text_only_and_wrong_model_do_not_confirm_vision(self):
        cases=[(chat_payload({"vision":True}),"vision_not_verified"),
               (chat_payload({},model="different"),"model_mismatch"),
               ({"model":MODEL,"choices":[{"message":{"content":"I can see it"}}]},"invalid_response"),
               ({"model":MODEL,"choices":[{"finish_reason":"length","message":{"content":"{}"}}]},"invalid_response")]
        for blob,code in cases:
            with patch.object(provider,"_request_json",return_value=blob):
                self.assertCode(code,provider.probe_vision,BASE,TEST_KEY,MODEL)

    def test_analyze_conveys_context_and_returns_parsed_dict(self):
        png, _=provider._hidden_card()
        assets=[{"id":"图层-8","mime":"image/png","data":png}]
        ctx={"assets":[{"id":"图层-8","width":144,"height":144}],"mode":"assets","outputShape":{"nodes":[]}}
        with patch.object(provider,"_request_json",return_value=chat_payload({"nodes":[]},model=MODEL+"-2025-01-02")) as request:
            self.assertEqual(provider.analyze(BASE,TEST_KEY,MODEL,assets,ctx),{"nodes":[]})
            post=request.call_args.args[-1]
            content=post["messages"][1]["content"]
            self.assertIn("图层-8",content[0]["text"])
            self.assertIn("图层-8",content[1]["text"])
            self.assertEqual(base64.b64decode(content[2]["image_url"]["url"].split(",",1)[1]),png)
        with patch.object(provider,"_request_json") as request:
            self.assertCode("invalid_input",provider.analyze,BASE,TEST_KEY,MODEL,assets+assets,ctx)
            self.assertCode("invalid_input",provider.analyze,BASE,TEST_KEY,MODEL,[dict(assets[0],mime="image/svg+xml")],ctx)
            self.assertCode("invalid_input",provider.analyze,BASE,TEST_KEY,MODEL,assets,{"bad":float("nan")})
            request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
