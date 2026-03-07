// Fix for undefined User-Agent header issue in ws/mqtt
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function(id) {
  const module = originalRequire.apply(this, arguments);
  if (id === 'http' || id === 'https') {
    const originalRequest = module.request;
    module.request = function(options, ...args) {
      if (typeof options === 'object' && options !== null && options.headers) {
        if (options.headers['User-Agent'] === undefined) {
          options.headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
        }
      }
      return originalRequest.call(this, options, ...args);
    };
  }
  return module;
};

const http = require('http');
const https = require('https');
const ClientRequest = require('http').ClientRequest;
const OriginalSetHeader = ClientRequest.prototype.setHeader;

ClientRequest.prototype.setHeader = function(name, value) {
  if (value === undefined) {
    if (name === 'User-Agent' || name === 'user-agent') {
      value = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    } else {
      return; 
    }
  }
  return OriginalSetHeader.call(this, name, value);
};

const login = require("aminul-new-fca");
const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const request = require("request");

const PORT = process.env.PORT || 3000;
const APPSTATE_JSON = process.env.APPSTATE_JSON;
const BOT_START_TIME = Date.now();
const CACHE_DIR = path.join(__dirname, "cache");
fs.ensureDirSync(CACHE_DIR);

const COMMANDS = {
  help: "Show all available commands and bot info",
  hello: "Say hello to the bot",
  uptime: "Show bot uptime",
  uid: "Get your user ID",
  ping: "Ping the bot",
  info: "Show admin information"
};

// --- Helper Functions ---
function getUptime() {
  const uptimeMs = Date.now() - BOT_START_TIME;
  const seconds = Math.floor((uptimeMs / 1000) % 60);
  const minutes = Math.floor((uptimeMs / (1000 * 60)) % 60);
  const hours = Math.floor((uptimeMs / (1000 * 60 * 60)) % 24);
  const days = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));
  return days > 0 ? `${days}d ${hours}h ${minutes}m ${seconds}s` : `${hours}h ${minutes}m ${seconds}s`;
}

function getHelpMessage() {
  let helpText = `📋 Bot Help - Total Commands: ${Object.keys(COMMANDS).length}\n\n`;
  for (const [cmd, desc] of Object.entries(COMMANDS)) {
    helpText += `/${cmd} - ${desc}\n`;
  }
  helpText += `\n💬 Or send a video URL to auto-download!`;
  return helpText;
}

// --- Main Bot Function ---
function startBot() {
    let appState;
    try {
        if (APPSTATE_JSON) {
            appState = JSON.parse(APPSTATE_JSON);
        } else if (fs.existsSync("appstate.json")) {
            appState = JSON.parse(fs.readFileSync("appstate.json", "utf8"));
        } else {
            console.error("❌ Error: No appstate found!");
            process.exit(1);
        }
    } catch (e) {
        console.error("❌ Error: Invalid JSON in AppState!");
        process.exit(1);
    }

    login({ appState }, (err, api) => {
        if (err) {
            console.error("❌ Login Error! Restarting in 10s...", err);
            return setTimeout(startBot, 10000); // ১০ সেকেন্ড পর আবার লগইন চেষ্টা করবে
        }

        console.log(`🚀 Bot logged in successfully! Running on port ${PORT}`);

        api.listenMqtt((err, event) => {
            if (err) {
                console.error("❌ MQTT Error! Restarting...", err);
                return startBot(); // এরর হলে অটো রিস্টার্ট
            }

            const { body, threadID, messageID, senderID, logMessageType } = event;
            if (!body) {
                if (logMessageType === "log:subscribe") {
                    api.sendMessage("👋 Welcome! Use /help to see commands.", threadID);
                }
                return;
            }

            const lowerBody = body.toLowerCase();
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const urls = body.match(urlRegex);

            if (urls && urls.length > 0) {
                urls.forEach(url => downloadVideo(url, threadID, messageID, api));
            } else if (lowerBody === "hello") {
                api.sendMessage("hello i am aminul bot", threadID, messageID);
            } else if (lowerBody === "help") {
                api.sendMessage(getHelpMessage(), threadID, messageID);
            } else if (lowerBody === "uptime") {
                api.sendMessage(`⏱ Bot Uptime: ${getUptime()}`, threadID, messageID);
            } else if (lowerBody === "uid") {
                api.sendMessage(`👤 Your User ID: ${senderID}`, threadID, messageID);
            } else if (lowerBody === "ping") {
                api.sendMessage("🏓 Pong! I'm online and working perfectly!", threadID, messageID);
            } else if (lowerBody === "info") {
                sendInfoMessage(threadID, messageID, api);
            }
        });
    });
}

// --- Additional Handlers ---
async function downloadVideo(url, threadID, messageID, api) {
    try {
        api.sendMessage("⏬ Downloading video...", threadID, messageID);
        const apiURL = `https://aminul-rest-api-three.vercel.app/downloader/alldownloader?url=${encodeURIComponent(url)}`;
        const res = await axios.get(apiURL);
        const data = res?.data?.data?.data;
        if (!data) return api.sendMessage("❌ Video data পাওয়া যায়নি।", threadID, messageID);

        const videoURL = data.high || data.low;
        if (!videoURL) return api.sendMessage("❌ Download link পাওয়া যায়নি।", threadID, messageID);

        const filePath = path.join(CACHE_DIR, `video_${Date.now()}.mp4`);
        request(videoURL)
            .pipe(fs.createWriteStream(filePath))
            .on("close", () => {
                api.sendMessage({ body: `🎬 𝗧𝗜𝗧𝗟𝗘: ${data.title || "No Title"}`, attachment: fs.createReadStream(filePath) }, threadID, () => fs.unlinkSync(filePath), messageID);
            });
    } catch (e) { console.error("Download Error:", e); }
}

function sendInfoMessage(threadID, messageID, api) {
    const imgPath = path.join(CACHE_DIR, "avatar.png");
    const avatarURL = "https://graph.facebook.com/100071880593545/picture?height=720&width=720";
    request(avatarURL).pipe(fs.createWriteStream(imgPath)).on("close", () => {
        api.sendMessage({
            body: `╭─〔🌸 𝐀𝐌𝐈𝐍𝐔𝐋𝐁𝐎𝐓 𝐈𝐍𝐅𝐎 🌸〕─╮\n│ 💫 Name: Aminul Sardar\n╰───〔💛 𝐀𝐌𝐈𝐍𝐔𝐋 𝐗 𝐁𝐎𝐓 💛〕───╯`,
            attachment: fs.createReadStream(imgPath)
        }, threadID, () => fs.unlinkSync(imgPath));
    });
}

// --- Auto-Restart on Crashes ---
process.on('uncaughtException', (err) => {
    console.error('⚠️ Uncaught Exception:', err);
    startBot(); // ক্র্যাশ করলে আবার শুরু করবে
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
    startBot(); // রিজেকশন হলেও রিস্টার্ট হবে
});

// ক্যাশ ক্লিনআপ (৩০ মিনিট পর পর)
setInterval(() => {
    fs.readdir(CACHE_DIR, (err, files) => {
        if (!err) files.forEach(f => fs.unlink(path.join(CACHE_DIR, f), () => {}));
    });
}, 1800000);

// বট চালু করুন
startBot();
