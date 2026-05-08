import { createApp } from 'vue';
import Button from 'ant-design-vue/es/button';
import Checkbox from 'ant-design-vue/es/checkbox';
import ConfigProvider from 'ant-design-vue/es/config-provider';
import Input from 'ant-design-vue/es/input';
import Select from 'ant-design-vue/es/select';
import Slider from 'ant-design-vue/es/slider';
import 'ant-design-vue/es/style/reset.css';
import App from './App.vue';

const app = createApp(App);
app.use(Button);
app.use(Input);
app.use(Checkbox);
app.use(Select);
app.use(Slider);
app.use(ConfigProvider);
app.mount('#app');
