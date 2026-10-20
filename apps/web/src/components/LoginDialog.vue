<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Aperture, ArrowRight, Eye, EyeOff, LockKeyhole, Sparkles, X } from '@lucide/vue';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const dialog = ref<HTMLDialogElement | null>(null);
const username = ref(''); const password = ref(''); const visible = ref(false);
const validation = ref('');
function submit() {
  validation.value = '';
  if (!username.value.trim() || !password.value) { validation.value = '请输入账号和密码。'; return; }
  if (password.value.length < 6 || password.value.length > 30) { validation.value = '密码须为 6–30 个字符。'; return; }
  auth.login(username.value.trim(), password.value).then(() => { password.value = ''; }).catch(() => {});
}
onMounted(() => { auth.error = ''; dialog.value?.showModal(); });
</script>

<template>
  <dialog ref="dialog" class="login-dialog" aria-labelledby="login-title" @cancel.prevent="auth.dismiss()" @close="auth.dismiss()">
    <button class="login-close" type="button" aria-label="关闭登录弹窗" :disabled="auth.loading" @click="auth.dismiss()"><X :size="21" /></button>
    <aside class="login-showcase" aria-label="Photo Studio 电商创作">
      <div class="login-brand"><Aperture :size="25" /><span>PHOTO <b>STUDIO</b></span></div>
      <div class="login-art" aria-hidden="true"><div class="login-poster back"><img src="/images/studio-fashion.webp" alt="" /></div><div class="login-poster front"><img src="/images/studio-coffee.webp" alt="" /><span>EVERYDAY, INSPIRED.</span></div><span class="login-spark">✳</span><span class="login-sticker"><Sparkles :size="13" /> 让商品，被看见。</span></div>
      <div class="login-caption"><h2>好商品，值得好设计。</h2><p>从一张商品图，到一整套品牌视觉</p><span>MADE FOR YOUR NEXT GREAT IDEA</span></div>
    </aside>
    <section class="login-form">
      <span class="login-eyebrow">WELCOME TO YOUR STUDIO</span>
      <h1 id="login-title">欢迎登录 Photo Studio</h1>
      <p class="login-intro">让灵感成为作品，从这里开始。</p>
      <form novalidate @submit.prevent="submit">
        <fieldset :disabled="auth.loading || auth.setupRequired">
          <label for="login-username">账号</label>
          <input id="login-username" v-model="username" name="username" autofocus autocomplete="username" placeholder="请输入管理员开通的账号" maxlength="32" :aria-invalid="Boolean(validation || auth.error)" @input="validation = ''; auth.error = ''" />
          <label for="login-password">密码</label>
          <div class="login-password"><input id="login-password" v-model="password" name="password" :type="visible ? 'text' : 'password'" autocomplete="current-password" placeholder="请输入 6–30 个字符的密码" minlength="6" maxlength="30" :aria-invalid="Boolean(validation || auth.error)" @input="validation = ''; auth.error = ''" /><button type="button" :aria-label="visible ? '隐藏密码' : '显示密码'" :aria-pressed="visible" @click="visible = !visible"><component :is="visible ? EyeOff : Eye" :size="18" /></button></div>
          <p class="login-error" role="alert">{{ validation || auth.error }}</p>
          <button class="login-submit" type="submit">{{ auth.loading ? '正在登录…' : '登录并开始创作' }}<ArrowRight v-if="!auth.loading" :size="17" /></button>
        </fieldset>
      </form>
      <p v-if="auth.setupRequired" class="login-setup" role="status">工作台尚未开通账号，请联系管理员完成初始化。</p>
      <p class="login-invitation">当前为邀请制，账号由管理员开通。<br />忘记密码？请联系管理员重置。</p>
      <div class="login-privacy"><LockKeyhole :size="13" /><span>你的项目与素材，仅在自己的空间中可见。</span></div>
    </section>
  </dialog>
</template>

<style scoped lang="scss">
.login-dialog {
  position: fixed; inset: 0; width: min(840px, calc(100vw - 40px)); max-height: calc(100dvh - 40px); margin: auto; padding: 0; overflow: auto; border: 0; border-radius: 24px; color: var(--text); background: #fff; box-shadow: 0 24px 80px rgb(28 24 48 / 22%);
  &[open] { display: grid; grid-template-columns: 40% 60%; }
  &::backdrop { background: rgb(32 35 48 / 30%); backdrop-filter: blur(3px); }
}
.login-close { position: absolute; z-index: 1; top: 16px; right: 16px; display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 50%; color: #9693a4; background: transparent; &:hover { background: #f5f3fa; color: var(--text); } }
.login-showcase { display: flex; flex-direction: column; min-height: 530px; padding: 26px 24px 34px; background: radial-gradient(circle at 1px 1px, #dcd6e9 1px, transparent 1px) 0 0 / 24px 24px, linear-gradient(145deg, #f1edf9, #f7f5fb); }
.login-brand { display: flex; gap: 9px; align-items: center; color: #302b43; font-size: 13px; letter-spacing: 1px; svg { color: #8060cf; } b { font-weight: 650; } }
.login-art { position: relative; flex: 1; min-height: 290px; }
.login-poster { position: absolute; width: 142px; padding: 7px; border: 1px solid rgb(255 255 255 / 80%); border-radius: 16px; background: #fff; box-shadow: 0 14px 35px rgb(84 61 124 / 13%); img { display: block; width: 100%; height: 176px; border-radius: 10px; object-fit: cover; } &.back { left: 9px; top: 60px; transform: rotate(-12deg); } &.front { right: 1px; top: 95px; transform: rotate(9deg); } > span { display: block; padding: 9px 0 3px; text-align: center; color: #877394; font-size: 7px; letter-spacing: 1px; } }
.login-spark { position: absolute; top: 32px; right: 31px; font-size: 35px; color: #b395dc; }
.login-sticker { position: absolute; display: flex; gap: 6px; align-items: center; bottom: 11px; left: 66px; padding: 8px 12px; border-radius: 24px; background: #fff; box-shadow: 0 6px 18px rgb(84 61 124 / 9%); color: #855cae; font-size: 10px; transform: rotate(-4deg); }
.login-caption { margin-top: 24px; text-align: center; h2 { font-size: 21px; font-weight: 600; letter-spacing: -.5px; } p { margin-top: 10px; color: #83798e; font-size: 11px; } > span { display: block; margin-top: 24px; color: #ada2b9; font-size: 7px; letter-spacing: 1.5px; } }
.login-form { padding: 64px 54px 32px; h1 { margin-top: 12px; font-size: 25px; font-weight: 650; letter-spacing: -.8px; } form { margin-top: 32px; } fieldset { margin: 0; padding: 0; border: 0; min-width: 0; } label { display: block; margin: 18px 0 8px; color: #686175; font-size: 12px; } input { width: 100%; height: 46px; padding: 0 14px; border: 1px solid #e6e2ed; border-radius: 10px; color: var(--text); background: #fbfafc; font-size: 13px; &::placeholder { color: #aaa4b5; } &:focus { outline: 2px solid #ded3f5; outline-offset: 2px; border-color: #a58ad9; } } }
.login-eyebrow { color: #a69ab7; font-size: 8px; letter-spacing: 1.7px; }
.login-intro { color: #96909f; font-size: 12px; margin-top: 10px; }
.login-password { position: relative; input { padding-right: 46px; } button { position: absolute; display: grid; place-items: center; right: 5px; top: 5px; width: 36px; height: 36px; border: 0; border-radius: 7px; background: transparent; color: #9a92a8; &:hover { color: #7659ab; background: #f0eaf7; } } }
.login-error { min-height: 18px; margin: 10px 0; color: var(--error); font-size: 11px; }
.login-submit { display: flex; justify-content: center; align-items: center; gap: 12px; width: 100%; height: 46px; border: 0; border-radius: 24px; background: linear-gradient(115deg, #8161d5, #a07cde); color: #fff; font-size: 13px; &:hover { filter: brightness(1.04); } }
.login-invitation { margin-top: 22px; text-align: center; color: #a19aa9; font-size: 11px; line-height: 1.9; }
.login-setup { margin-top: 12px; color: #94703f; font-size: 12px; line-height: 1.7; }
.login-privacy { display: flex; gap: 6px; align-items: center; justify-content: center; margin-top: 30px; color: #aba5b4; font-size: 10px; }
@media (max-width: 760px) { .login-form { padding: 54px 30px 30px; h1 { font-size: 22px; } } .login-brand { font-size: 10px; } .login-showcase { padding-inline: 16px; } .login-poster { width: 120px; img { height: 154px; } } .login-caption h2 { font-size: 17px; } .login-sticker { left: 20px; } }
@media (max-width: 580px) { .login-dialog[open] { grid-template-columns: 1fr; } .login-showcase { display: none; } .login-form { padding: 48px 28px 30px; } }
</style>
