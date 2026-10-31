// Creates original, silent animated concept placeholders. No game footage is used.
// node tools/generate-previews.cjs <absolute path to playwright package>
const { chromium } = require(process.argv[2] || "playwright");
const fs = require("node:fs");
const path = require("node:path");
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 960, height: 580 },
    });
    await page.setContent('<canvas width="960" height="580"></canvas>');
    const dir = path.resolve(__dirname, "../public/videos");
    fs.mkdirSync(dir, { recursive: true });
    for (const kind of ["farming", "upgrades", "insights"]) {
      const result = await page.evaluate(async (kind) => {
        const canvas = document.querySelector("canvas"),
          c = canvas.getContext("2d");
        function rect(x, y, w, h, color, r = 8) {
          c.fillStyle = color;
          c.beginPath();
          c.roundRect(x, y, w, h, r);
          c.fill();
        }
        function text(str, x, y, size = 14, color = "#b6a5c9") {
          c.font = `${size}px Arial`;
          c.fillStyle = color;
          c.fillText(str, x, y);
        }
        function draw(t) {
          const bg = c.createRadialGradient(480, 250, 40, 480, 300, 650);
          bg.addColorStop(0, "#322640");
          bg.addColorStop(1, "#15131d");
          c.fillStyle = bg;
          c.fillRect(0, 0, 960, 580);
          c.strokeStyle = "#b99cd009";
          c.lineWidth = 1;
          for (let x = 0; x < 960; x += 28) {
            c.beginPath();
            c.moveTo(x, 0);
            c.lineTo(x, 580);
            c.stroke();
          }
          for (let y = 0; y < 580; y += 28) {
            c.beginPath();
            c.moveTo(0, y);
            c.lineTo(960, y);
            c.stroke();
          }
          rect(82, 65, 796, 445, "#131219", 12);
          rect(83, 66, 794, 34, "#25202f", 11);
          rect(83, 88, 794, 13, "#25202f", 0);
          ["#9b7cba", "#65586e", "#51485c"].forEach((color, i) =>
            rect(99 + i * 14, 79, 6, 6, color, 3),
          );
          text(
            "DRYAD / " +
              {
                farming: "DEPLOYMENT",
                upgrades: "UPGRADES",
                insights: "INSIGHTS",
              }[kind],
            154,
            86,
            9,
            "#bca5d1",
          );
          if (kind === "farming") {
            for (let row = 0; row < 10; row++)
              for (let col = 0; col < 13; col++) {
                let x = 350 + (col - row) * 21,
                  y = 132 + (col + row) * 13;
                c.fillStyle = (col + row) % 2 ? "#292c2d" : "#25292a";
                c.beginPath();
                c.moveTo(x, y);
                c.lineTo(x + 20, y + 12);
                c.lineTo(x, y + 24);
                c.lineTo(x - 20, y + 12);
                c.closePath();
                c.fill();
                if ((col * 7 + row * 3) % 13 === 0) {
                  rect(x - 9, y - 7, 18, 21, "#54465f", 2);
                  rect(x - 7, y - 9, 14, 6, "#857196", 2);
                }
              }
            c.strokeStyle = "#ac7ee6";
            c.setLineDash([4, 6]);
            c.lineWidth = 2;
            c.beginPath();
            c.ellipse(390, 302, 226, 119, 0, 0, Math.PI * 2);
            c.stroke();
            c.setLineDash([]);
            for (let i = 0; i < 7; i++) {
              const a = i * 0.42 + t * Math.PI * 2;
              let x = 390 + Math.cos(a) * 226,
                y = 302 + Math.sin(a) * 119;
              const glow = c.createRadialGradient(x, y, 0, x, y, 19);
              glow.addColorStop(0, "#cfa7ff70");
              glow.addColorStop(1, "#b482ef00");
              c.fillStyle = glow;
              c.fillRect(x - 19, y - 19, 38, 38);
              rect(x - 3, y - 3, 6, 6, "#d7b4ff", 3);
            }
            rect(641, 128, 207, 326, "#211d2b", 8);
            text("YOUR DEPLOYMENT", 661, 156, 10, "#a88cbf");
            text("A plan for every run.", 661, 189, 17, "#e4d6f0");
            text("Preset", 661, 224, 10, "#7b6a89");
            rect(658, 239, 173, 35, "#30263e", 5);
            text("Balanced perimeter", 670, 261, 12, "#c7addf");
            text("Deployment radius", 661, 307, 11);
            rect(661, 327, 165, 3, "#40324f");
            rect(661, 327, 115, 3, "#af86e4");
            rect(771, 322, 12, 12, "#d7b2ff", 6);
            text("Stop conditions", 661, 370, 11);
            text("Always in your control", 661, 393, 10, "#7f718c");
            rect(659, 412, 171, 26, "#8a5bbf", 4);
            text("Preset preview", 704, 429, 10, "#edddff");
          } else if (kind === "upgrades") {
            text("THE NEXT LITTLE WIN", 124, 143, 10, "#9277aa");
            text("Progress, one upgrade at a time.", 124, 178, 24, "#e5d5f1");
            for (let i = 0; i < 7; i++) {
              let x = 155 + i * 66,
                y = 278 + Math.sin(i * 0.6) * 8;
              const lit = i < Math.floor(t * 7);
              rect(x, y, 40, 63, lit ? "#8c6ca5" : "#4b3d58", 4);
              rect(x - 3, y - 4, 46, 16, lit ? "#bd98d7" : "#70577f", 3);
              rect(x + 9, y + 28, 5, 22, lit ? "#d1b1e2" : "#6c557c", 2);
            }
            rect(125, 384, 465, 69, "#221c2c");
            text("Wall upgrades", 144, 411, 14, "#cbb4df");
            text("Illustrative upgrade sequence", 144, 433, 10, "#786587");
            rect(456, 404, 112, 28, "#9871c322", 5);
            text("Preview", 493, 423, 11, "#bc9bd7");
            rect(638, 132, 207, 320, "#231d2e");
            text("SESSION PROGRESS", 660, 160, 10, "#ad8bc8");
            text("Wall management", 660, 197, 17, "#dec9ed");
            text("Upgrades previewed", 660, 240, 11);
            text(
              String(Math.floor(t * 7)).padStart(2, "0"),
              660,
              290,
              40,
              "#bd94e4",
            );
            rect(661, 313, 158, 4, "#44304f");
            rect(661, 313, 158 * t, 4, "#b18bdb");
            text("Hero workflow", 660, 360, 13);
            text("Status and controls", 660, 387, 10, "#8b739d");
            text("in one place.", 660, 406, 10, "#8b739d");
          } else {
            text("A CLEARER PICTURE", 124, 143, 10, "#aa8ac3");
            text("Know where your session goes.", 124, 178, 24, "#e6d7f2");
            [
              { name: "SESSION TIME", value: "02h 34m" },
              { name: "GOLD COLLECTED", value: "12.8M" },
              { name: "COMPLETED RUNS", value: "48" },
            ].forEach((m, i) => {
              rect(124 + i * 244, 204, 225, 83, "#221d2c");
              text(m.name, 142 + i * 244, 228, 9, "#927aab");
              text(m.value, 142 + i * 244, 266, 26, "#e4d1f0");
            });
            rect(124, 309, 713, 144, "#1d1925");
            for (let y = 335; y < 450; y += 30) {
              c.strokeStyle = "#ffffff08";
              c.beginPath();
              c.moveTo(140, y);
              c.lineTo(821, y);
              c.stroke();
            }
            c.beginPath();
            for (let i = 0; i < 70; i++) {
              let x = 142 + i * 9.7,
                y = 426 - i * 1.25 - Math.sin(i * 0.5 + t * 6.28) * 8;
              i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
            }
            c.strokeStyle = "#b488e5";
            c.lineWidth = 3;
            c.stroke();
            text("00:00", 142, 476, 9, "#867196");
            text("02:30", 794, 476, 9, "#867196");
          }
        }
        draw(0.33);
        const poster = canvas.toDataURL("image/png").split(",")[1];
        const stream = canvas.captureStream(24),
          recorder = new MediaRecorder(stream, {
            mimeType: "video/webm;codecs=vp9",
            videoBitsPerSecond: 1200000,
          }),
          chunks = [];
        recorder.ondataavailable = (e) => chunks.push(e.data);
        const done = new Promise((resolve) => (recorder.onstop = resolve));
        recorder.start();
        const start = performance.now();
        await new Promise((resolve) => {
          function frame(now) {
            const elapsed = now - start;
            draw((elapsed % 4000) / 4000);
            if (elapsed < 4000) requestAnimationFrame(frame);
            else resolve();
          }
          requestAnimationFrame(frame);
        });
        recorder.stop();
        await done;
        stream.getTracks().forEach((t) => t.stop());
        const bytes = new Uint8Array(
          await new Blob(chunks, { type: "video/webm" }).arrayBuffer(),
        );
        let binary = "";
        for (const b of bytes) binary += String.fromCharCode(b);
        return { video: btoa(binary), poster };
      }, kind);
      fs.writeFileSync(
        path.join(dir, kind + ".webm"),
        Buffer.from(result.video, "base64"),
      );
      fs.writeFileSync(
        path.join(dir, kind + ".png"),
        Buffer.from(result.poster, "base64"),
      );
      console.log("Created " + kind + " preview");
    }
  } finally {
    await browser.close();
  }
})();
