js
/* ------------------------------------------------------------------ */
/*  Player – semplice wrapper attorno a <video> (compatibile con app) */
/* ------------------------------------------------------------------ */
export class Player {
  /**
   * @param {string} containerSel   CSS selector dove inserire il video
   * @param {object}  opts           { src:string, autoplay?:bool, muted?:bool }
   */
  constructor(containerSel, opts = {}) {
    this.container = document.querySelector(containerSel);
    this.video = document.createElement("video");
    this.video.controls = true;
    this.video.style.width = "100%";
    this.video.style.borderRadius = "8px";
    this.video.preload = "metadata";
    this.video.autoplay = opts.autoplay ?? false;
    this.video.muted    = opts.muted ?? false;
    if (opts.src) this.video.src = opts.src;
    this.container.appendChild(this.video);
  }

  load(src) {
    this.video.src = src;
    this.video.load();
    this.play();
  }
  play()  { this.video.play(); }
  pause() { this.video.pause(); }
  seek(seconds) { this.video.currentTime = seconds; }

  /* callback per il watch‑time (impostata da app.js) */
  set onTimeUpdate(cb) {
    this.video.addEventListener("timeupdate", () => {
      /* ogni 5 sec per limitare le scritture */
      if (Math.floor(this.video.currentTime) % 5 === 0) cb(this.video.currentTime);
    });
  }
}