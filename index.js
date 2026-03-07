// Fix for undefined User-Agent header issue in ws/mqtt
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function(id) {
  const module = originalRequire.apply(this, arguments);
  
  // Patch ClientRequest after requiring http/https modules
  if (id === 'http' || id === 'https') {
    const originalRequest = module.request;
    module.request = function(options, ...args) {
      if (typeof options === 'object' && options !== null && options.headers) {
        // Replace undefined User-Agent with a valid one
        if (options.headers['User-Agent'] === undefined) {
          options.headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
        }
      }
      return originalRequest.call(this, options, ...args);
    };
  }
  
  return module;
};

// Also patch the Agent setHeader method to reject undefined values
const http = require('http');
const https = require('https');
const ClientRequest = require('http').ClientRequest;
const OriginalSetHeader = ClientRequest.prototype.setHeader;

ClientRequest.prototype.setHeader = function(name, value) {
  if (value === undefined) {
    // Silently replace undefined headers with a valid User-Agent
    if (name === 'User-Agent' || name === 'user-agent') {
      value = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    } else {
      return; // Skip undefined headers
    }
  }
  return OriginalSetHeader.call(this, name, value);
};

const login = require("aminul-new-fca");
const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const request = require("request");
const express = require("express"); // Added express

// Configuration from environment variables
const PORT = process.env.PORT || 3000;
const APPSTATE_JSON = process.env.APPSTATE_JSON;

// Bot startup time for uptime tracking
const BOT_START_TIME = Date.now();

// Define available commands
const COMMANDS = {
  help: "Show all available commands and bot info",
  hello: "Say hello to the bot",
  uptime: "Show bot uptime"
};

// Create Express server for health checks
const app = express();

app.get('/', (req, res) => {
  res.json({
    status: 'Bot is running',
    uptime: getUptime(),
    commands: Object.keys(COMMANDS).length,
    startTime: new Date(BOT_START_TIME).toISOString()
  });
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Start the HTTP server
const server = app.listen(PORT, () => {
  console.log(`✅ HTTP Server is running on port ${PORT}`);
});

// Get appstate - either from environment variable or file
let appState;
if (APPSTATE_JSON) {
  try {
    appState = JSON.parse(APPSTATE_JSON);
    console.log("✅ Using APPSTATE_JSON from environment variable");
  } catch (error) {
    console.error(`❌ ERROR: Invalid APPSTATE_JSON environment variable!`);
    process.exit(1);
  }
} else if (fs.existsSync("appstate.json")) {
  try {
    appState = JSON.parse(fs.readFileSync("appstate.json", "utf8"));
    console.log("✅ Using appstate.json from file");
  } catch (error) {
    console.error(`❌ ERROR: Invalid appstate.json file!`);
    process.exit(1);
  }
} else {
  console.error(`❌ ERROR: Facebook account credentials not found!`);
  console.error(`📌 Please provide either:`);
  console.error(`   1. Set APPSTATE_JSON environment variable with your account credentials (JSON)`);
  console.error(`   2. Add 'appstate.json' file to the project root directory`);
  process.exit(1);
}

// Ensure cache folder exists
const CACHE_DIR = path.join(__dirname, "cache");
fs.ensureDirSync(CACHE_DIR);

// Clean up old cache files (older than 1 hour)
function cleanCache() {
  fs.readdir(CACHE_DIR, (err, files) => {
    if (err) return console.error("❌ Cache cleanup error:", err);
    const now = Date.now();
    files.forEach(file => {
      const filePath = path.join(CACHE_DIR, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;
        if (now - stats.mtimeMs > 3600000) { // 1 hour
          fs.unlink(filePath).catch(console.error);
        }
      });
    });
  });
}

// Schedule cache cleanup every 30 minutes
setInterval(cleanCache, 1800000);

// Bot login
login(
  { appState: appState },
  (err, api) => {
    if (err) {
      console.error("❌ Login error:", err);
      return;
    }
    
    console.log(`🚀 Bot running on port ${PORT}`);
    console.log("✅ Bot Login Success!");

    api.listenMqtt((err, event) => {
      if (err) {
        console.error("❌ MQTT error:", err);
        return;
      }

      const { body, threadID, messageID } = event;
      if (!body) return;

      const lowerBody = body.toLowerCase().trim();

      // Auto-download URL
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      const urls = body.match(urlRegex);
      
      if (urls && urls.length > 0) {
        urls.forEach(url => downloadVideo(url, threadID, messageID, api));
      } else if (lowerBody === "hello") {
        api.sendMessage("Hello! I am Aminul Bot 🤖", threadID, messageID);
      } else if (lowerBody === "help" || lowerBody === "/help") {
        api.sendMessage(getHelpMessage(), threadID, messageID);
      } else if (lowerBody === "uptime" || lowerBody === "/uptime") {
        api.sendMessage(`⏱ Bot Uptime: ${getUptime()}`, threadID, messageID);
      }
    });
  }
);

// Uptime helper
function getUptime() {
  const uptimeMs = Date.now() - BOT_START_TIME;
  const seconds = Math.floor((uptimeMs / 1000) % 60);
  const minutes = Math.floor((uptimeMs / (1000 * 60)) % 60);
  const hours = Math.floor((uptimeMs / (1000 * 60 * 60)) % 24);
  const days = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  
  return parts.join(' ');
}

// Help message
function getHelpMessage() {
  let helpText = `📋 **Bot Help Menu**\n`;
  helpText += `━━━━━━━━━━━━━━\n`;
  helpText += `Total Commands: ${Object.keys(COMMANDS).length}\n\n`;
  
  for (const [cmd, desc] of Object.entries(COMMANDS)) {
    helpText += `▸ ${cmd} - ${desc}\n`;
  }
  
  helpText += `\n💡 **Features:**\n`;
  helpText += `▸ Send any video URL (YouTube, Facebook, etc.)\n`;
  helpText += `▸ Auto-download and send video\n`;
  helpText += `\n⏱ Uptime: ${getUptime()}`;
  
  return helpText;
}

// Video downloader
async function downloadVideo(url, threadID, messageID, api) {
  try {
    api.sendMessage("⏬ Downloading video...", threadID, messageID);

    const apiURL = `https://aminul-rest-api-three.vercel.app/downloader/alldownloader?url=${encodeURIComponent(url)}`;
    const res = await axios.get(apiURL);
    const data = res?.data?.data?.data;

    if (!data) {
      return api.sendMessage("❌ Could not fetch video data. Make sure the URL is valid.", threadID, messageID);
    }

    const { title, high, low } = data;
    const videoURL = high || low;
    
    if (!videoURL) {
      return api.sendMessage("❌ No download link available for this video.", threadID, messageID);
    }

    const filePath = path.join(CACHE_DIR, `autolink_${Date.now()}.mp4`);
    
    request(videoURL)
      .pipe(fs.createWriteStream(filePath))
      .on("close", () => {
        api.sendMessage(
          { 
            body: `🎬 **Title:**\n${title || "Unknown"}`, 
            attachment: fs.createReadStream(filePath) 
          },
          threadID,
          () => {
            fs.unlink(filePath).catch(err => 
              console.error("❌ Error deleting file:", err)
            );
          },
          messageID
        );
      })
      .on("error", (error) => {
        console.error("Download error:", error);
        api.sendMessage("❌ Video download failed!", threadID, messageID);
        fs.unlink(filePath).catch(() => {});
      });
  } catch (error) {
    console.error("Error in downloadVideo:", error);
    api.sendMessage("❌ An error occurred while processing your request.", threadID, messageID);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  server.close(() => {
    console.log('✅ HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down...');
  server.close(() => {
    console.log('✅ HTTP server closed');
    process.exit(0);
  });
});

console.log("✅ Bot initialization complete. Waiting for messages...");
