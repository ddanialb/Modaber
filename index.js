require("dotenv").config();
const axios = require("axios");
const cheerio = require("cheerio");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");

// Login credentials
const USERNAME = "020121971";
const PASSWORD = "132375";
const LOGIN_URL =
  "https://haftometir.modabberonline.com/Login.aspx?ReturnUrl=%2f&AspxAutoDetectCookieSupport=1";

// Function to login to Modabber system
async function loginToModabber() {
  console.log("🔄 Logging in to Modabber system...");
  console.log(`👤 Username: ${USERNAME}`);
  console.log(`🔑 Password: ${PASSWORD}`);

  const jar = new CookieJar();
  const client = wrapper(axios.create({ jar }));

  try {
    // Step 1: Get login page to extract hidden fields
    console.log("📄 Fetching login page...");
    const loginPageResponse = await client.get(LOGIN_URL);
    const $ = cheerio.load(loginPageResponse.data);

    // Step 2: Prepare form data
    const formData = new URLSearchParams();

    // Extract hidden fields
    $('input[type="hidden"]').each((i, elem) => {
      const name = $(elem).attr("name");
      const value = $(elem).attr("value");
      if (name && value) {
        formData.append(name, value);
      }
    });

    // Add credentials
    formData.append("txtUserName", USERNAME);
    formData.append("txtPassword", PASSWORD);
    formData.append("LoginButton", "ورود به سیستم");

    console.log("📤 Sending login credentials...");

    // Step 3: Submit login form
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

    console.log(`📊 HTTP Status: ${loginResponse.status}`);

    // Check if login was successful
    const $response = cheerio.load(loginResponse.data);

    // Check for error messages
    const errorMessage = $response("#lblMessage").text().trim();
    const loginError = $response(".error-message").text().trim();
    const validationError = $response(".validation-summary-errors")
      .text()
      .trim();

    if (errorMessage || loginError || validationError) {
      console.error("❌ Login failed!");
      console.error(
        "📝 Error message:",
        errorMessage ||
          loginError ||
          validationError ||
          "Invalid username or password"
      );
      return false;
    }

    // If redirected (302), login was successful
    if (loginResponse.status === 302 || loginResponse.status === 301) {
      const redirectUrl = loginResponse.headers.location;
      console.log("✅ Login successful!");
      console.log(`🔗 Redirected to: ${redirectUrl}`);

      // Get cookies
      const cookies = jar.getCookiesSync(LOGIN_URL);
      console.log(`🍪 Cookies received: ${cookies.length}`);
      cookies.forEach((cookie) => {
        console.log(
          `   - $${cookie.key}: $${cookie.value.substring(0, 20)}...`
        );
      });

      return true;
    }

    // If still on login page, login failed
    if ($response('input[name="txtUserName"]').length > 0) {
      console.error("❌ Login failed!");
      console.error(
        "📝 Reason: Still on login page - probably wrong username or password"
      );
      return false;
    }

    // If redirected to another page
    console.log("✅ Login successful!");
    return true;
  } catch (error) {
    if (error.response && error.response.status === 302) {
      // Redirect means success
      console.log("✅ Login successful! (Redirect detected)");
      return true;
    }

    console.error("❌ Error during login process:");
    console.error("📝 Error message:", error.message);
    if (error.response) {
      console.error("📊 HTTP Status:", error.response.status);
    }
    return false;
  }
}

// Run login
loginToModabber().then((success) => {
  if (success) {
    console.log("\n🎉 Login process completed successfully");
  } else {
    console.log("\n⚠️ Login process failed");
  }
});
