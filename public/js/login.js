import { api } from "./api.js";
import { toast } from "./utils.js";

const $ = id => document.getElementById(id);

$("btn-login").addEventListener("click", doLogin);

document.addEventListener("keydown", e => {
  if (e.key === "Enter") doLogin();
});

async function doLogin() {
  const username = $("username").value.trim();
  const password = $("password").value;
  const msg = $("msg");

  msg.textContent = "";

  if (!username || !password) {
    msg.textContent = "Kullanıcı adı ve şifre zorunludur.";
    return;
  }

  $("btn-login").disabled = true;
  $("btn-login").textContent = "Giriş yapılıyor…";

  try {
    await api("/api/login", { method: "POST", body: { username, password } });
    const me = await api("/api/me");
    window.location.href = me.user.role === "moderator" ? "/moderator.html" : "/employee.html";
  } catch (e) {
    msg.textContent = e.message;
    $("btn-login").disabled = false;
    $("btn-login").textContent = "Giriş Yap";
  }
}
