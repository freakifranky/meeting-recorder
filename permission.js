const msg = document.getElementById('msg');
async function ask() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach(t => t.stop());
    msg.textContent = 'Done. Close this tab, open your call tab, click the extension icon, and press Start recording.';
  } catch (e) {
    msg.textContent = 'Microphone blocked (' + e.name + '). Click the icon at the right of the address bar, allow the microphone, then press the button again.';
  }
}
document.getElementById('go').onclick = ask;
ask();
