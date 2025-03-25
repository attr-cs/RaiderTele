require("dotenv").config();
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const { Server } = require("socket.io");
const http = require("http");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 4000;

const bot = new TelegramBot(process.env.BOT_TOKEN);
const WEBHOOK_URL = process.env.WEBHOOK_URL + "/webhook";
const BOT_USERNAME = process.env.BOT_USERNAME || "@YourBotUsername";
const ADMIN_PASSWORD_HASH = bcrypt.hashSync("xAI_Grok_Rules_2025!", 10);
const DB_URL = process.env.DB_URL;
const VALID_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "21:9", "9:21"];

const MODELS = {
  RAIDER: "raider",
  FLUX: "flux",
  TURBO: "turbo",
  IMAGEN3: "imagen3"
};

const modelNames = {
  [MODELS.RAIDER]: "Raider",
  [MODELS.FLUX]: "Flux",
  [MODELS.TURBO]: "Turbo",
  [MODELS.IMAGEN3]: "Imagen3"
};

const genAI1 = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const genAI2 = new GoogleGenerativeAI(process.env.GEMINI_API_KEY2);

const ImageLogSchema = new mongoose.Schema({
  prompt: String,
  url: String,
  user: Object,
  timestamp: { type: Date, default: Date.now },
  chatId: String,
  model: String,
});
const UsageSchema = new mongoose.Schema({
  date: { type: String, default: () => new Date().toISOString().split("T")[0] },
  imageCount: { type: Number, default: 0 },
});
const UserConfigSchema = new mongoose.Schema({
  userId: String,
  defaultModel: { type: String, default: MODELS.TURBO },
  imageCount: { type: Number, default: 0 },
});
const ImageLog = mongoose.model("ImageLog", ImageLogSchema);
const Usage = mongoose.model("Usage", UsageSchema);
const UserConfig = mongoose.model("UserConfig", UserConfigSchema);

const imageGenerationQueue = [];
let isProcessingQueue = false;
let botRunning = false;
const activeChats = new Set();
const activeUsers = new Set();

mongoose.connect(DB_URL, { 
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000
})
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

app.use(express.json());
app.use(express.static("public"));

bot.setWebHook(WEBHOOK_URL)
  .then(() => console.log(`Webhook set to: ${WEBHOOK_URL}`))
  .catch((err) => console.error("Webhook Error:", err));

async function generateRandomPrompt() {
  const systemPrompt = "Generate a creative, detailed and imaginative prompt for AI image generation. Make it vivid and specific, focusing on visual elements. Return only the prompt text without any explanations or additional text.";
  
  try {
    try {
      const model = genAI1.getGenerativeModel({ model: "gemini-2.0-flash" });
      const result = await model.generateContent(systemPrompt);
      return result.response.text().trim();
    } catch (error) {
      console.error("First Gemini API key failed:", error);
      const model = genAI2.getGenerativeModel({ model: "gemini-2.0-flash" });
      const result = await model.generateContent(systemPrompt);
      return result.response.text().trim();
    }
  } catch (error) {
    console.error("Both Gemini API keys failed:", error);
    throw new Error("Failed to generate random prompt. Please try again.");
  }
}

async function generateImage(prompt, model = MODELS.FLUX, aspectRatio = "1:1") {
  try {
    const seed = Math.floor(Math.random() * 999999) + 1;
    
    if (model === MODELS.IMAGEN3) {
      try {
        try {
          const genAI = genAI1;
          const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
          const result = await model.generateContent(prompt);
          console.log("Gemini Imagen3 not fully supported yet, falling back to Turbo model");
          const encodedPrompt = encodeURIComponent(prompt);
          return `https://image.pollinations.ai/prompt/${encodedPrompt}?model=turbo&seed=${seed}&nologo=true&private=true&safe=false`;
        } catch (error) {
          console.error("First Gemini API key failed for image:", error);
          const genAI = genAI2;
          const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
          const result = await model.generateContent(prompt);
          console.log("Gemini Imagen3 not fully supported yet, falling back to Turbo model");
          const encodedPrompt = encodeURIComponent(prompt);
          return `https://image.pollinations.ai/prompt/${encodedPrompt}?model=turbo&seed=${seed}&nologo=true&private=true&safe=false`;
        }
      } catch (error) {
        console.error("Both Gemini API keys failed for image:", error);
        throw new Error("Image generation with Imagen3 failed. Falling back to Turbo model.");
      }
    } else if (model === MODELS.RAIDER) {
      const config = {
        headers: { 
          "accept": "*/*", 
          "content-type": "text/plain;charset=UTF-8" 
        },
        timeout: 15000,
      };
      
      const response = await axios.post(
        "https://websim.ai/api/v1/inference/run_image_generation",
        JSON.stringify({
          project_id: "kx0m131_rzz66qb2xoy7",
          prompt,
          aspect_ratio: aspectRatio,
        }),
        config
      );
      return response.data.url;
    } else {
      const encodedPrompt = encodeURIComponent(prompt);
      return `https://image.pollinations.ai/prompt/${encodedPrompt}?model=${model}&seed=${seed}&nologo=true&private=true&safe=false`;
    }
  } catch (error) {
    console.error("Image generation error:", error);
    throw error;
  }
}

async function processImageQueue() {
  if (isProcessingQueue || imageGenerationQueue.length === 0) return;
  isProcessingQueue = true;

  while (imageGenerationQueue.length > 0) {
    const { chatId, prompt, model, userInfo, isRandomPrompt } = imageGenerationQueue.shift();
    const timestamp = new Date().toISOString();
    let displayModelName = modelNames[model] || model;

    try {
      io.emit("imageStatus", { 
        isGeneratingImage: true, 
        model: displayModelName, 
        prompt, 
        user: userInfo.displayName 
      });
      
      await bot.sendMessage(chatId, 
        `Generating image using ${displayModelName} for:\n\`${prompt}\``,
        { parse_mode: 'Markdown' }
      );

      let imageUrl;
      try {
        imageUrl = await generateImage(prompt, model);
      } catch (error) {
        if (model === MODELS.IMAGEN3) {
          displayModelName = modelNames[MODELS.TURBO] + " (Fallback)";
          await bot.sendMessage(chatId, 
            "⚠️ Imagen3 generation failed. Falling back to Turbo model...",
            { parse_mode: 'Markdown' }
          );
          imageUrl = await generateImage(prompt, MODELS.TURBO);
        } else {
          throw error;
        }
      }

      await bot.sendPhoto(chatId, imageUrl, {
        caption: isRandomPrompt 
          ? `✨ Generated using ${displayModelName}`  // No prompt for random generations
          : `✨ Generated using ${displayModelName}\n\nPrompt:\n\`${prompt}\``,
        parse_mode: 'Markdown'
      });

      const today = new Date().toISOString().split("T")[0];
      await Usage.findOneAndUpdate(
        { date: today }, 
        { $inc: { imageCount: 1 } }, 
        { upsert: true }
      );
      await UserConfig.findOneAndUpdate(
        { userId: userInfo.id }, 
        { $inc: { imageCount: 1 } }, 
        { upsert: true }
      );

      const imageData = new ImageLog({ 
        prompt, 
        url: imageUrl, 
        user: userInfo, 
        timestamp, 
        chatId, 
        model 
      });
      await imageData.save();
      io.emit("imageLog", imageData);
    } catch (error) {
      await bot.sendMessage(chatId, 
        "❌ An error occurred during image generation. Please try again or choose a different model.",
        { parse_mode: 'Markdown' }
      );
      io.emit("log", { type: "ERROR", message: error.message, timestamp });
    }
  }

  isProcessingQueue = false;
  io.emit("imageStatus", { isGeneratingImage: false, model: null, prompt: null, user: null });
}

const startMessage = `
Greetings! I am your advanced image generation assistant. Here's how to utilize my capabilities:
- /start - View this help message
- /img <prompt> - Generate an image using your default model
- /model - Change your default model
- /rdm - Receive a randomly generated creative prompt
- /rnds - Automatically generate an image from a random prompt
- /status - View the current operational status

Available models:
• Raider - High Quality, Fast
• Flux - Balanced quality and speed
• Turbo - Enhanced detail and creativity (Default)
• Imagen3 - Google's advanced AI model

Example usage: "/img A majestic castle in the clouds"
`;

const validateCommand = (text, command) => {
  return text.startsWith(command) || 
    (text.startsWith("/") && text.startsWith(command.slice(1), 1));
};

app.post("/webhook", async (req, res) => {
  const { message } = req.body;
  if (!message || !message.chat || !message.from || !botRunning) {
    return res.sendStatus(200);
  }

  const chatId = message.chat.id;
  const userInfo = {
    id: message.from.id,
    firstName: message.from.first_name,
    lastName: message.from.last_name,
    username: message.from.username,
    displayName: `${message.from.first_name} ${message.from.last_name || ""} ${message.from.username ? `(@${message.from.username})` : ""}`.trim(),
  };
  const text = message.text?.trim() || "";
  const timestamp = new Date().toISOString();

  activeUsers.add(userInfo.id);
  io.emit("userTraffic", { activeUsers: activeUsers.size });
  io.emit("log", { type: "MESSAGE", message: `${userInfo.displayName}: ${text}`, timestamp, userInfo });

  try {
    if (!activeChats.has(chatId)) {
      await bot.sendMessage(chatId, startMessage);
      activeChats.add(chatId);
    }

    if (validateCommand(text, "/start")) {
      await bot.sendMessage(chatId, startMessage);
    } 
    else if (validateCommand(text, "/status")) {
      const queueSize = imageGenerationQueue.length;
      const userConfig = await UserConfig.findOne({ userId: userInfo.id }) || { defaultModel: MODELS.TURBO };
      const status = `🤖 Bot Status: ${botRunning ? "Active ✅" : "Inactive ❌"}
📊 Queue Size: ${queueSize} ${queueSize > 0 ? "🔄" : "✅"}
🎨 Your Default Model: ${modelNames[userConfig.defaultModel]} 
🖼 Your Total Images: ${userConfig.imageCount || 0}`;

      await bot.sendMessage(chatId, status);
    }
    else if (validateCommand(text, "/rdm")) {
      try {
        const randomPrompt = await generateRandomPrompt();
        await bot.sendMessage(chatId, 
          `🎨 Random Prompt:\n\`${randomPrompt}\``, 
          { parse_mode: 'Markdown' }  // Only keeping Markdown formatting for copiable text
        );
      } catch (error) {
        console.error("Random prompt generation error:", error);
        await bot.sendMessage(chatId, "Failed to generate a random prompt. Please try again.");
      }
    }
    else if (validateCommand(text, "/rnds")) {
      try {
        const randomPrompt = await generateRandomPrompt();
        const userConfig = await UserConfig.findOne({ userId: userInfo.id }) || { defaultModel: MODELS.TURBO };
        let model = userConfig.defaultModel;
        
        // If model is Imagen3, use Turbo instead
        if (model === MODELS.IMAGEN3) {
          model = MODELS.TURBO;
          await bot.sendMessage(chatId, 
            "⚠️ Imagen3 is not supported for random generation. Using Turbo model instead.",
            { parse_mode: 'Markdown' }
          );
        }
        
        // Add a flag to indicate this is from /rnds command
        imageGenerationQueue.push({ 
          chatId, 
          prompt: randomPrompt, 
          model, 
          userInfo,
          isRandomPrompt: true // Add this flag
        });

        await bot.sendMessage(chatId, 
          // `🎨 Queued random prompt for generation:\n\`${randomPrompt}\`\n\nModel: ${modelNames[model]}`,
          `🎨 Queued random prompt for generation...`
        );
        
        processImageQueue();
      } catch (error) {
        await bot.sendMessage(chatId, "Failed to generate image. Please try again.");
      }
    }
    else if (validateCommand(text, "/model")) {
      const keyboard = {
        reply_markup: {
          keyboard: [
            ["1. Raider"],
            ["2. Flux"],
            ["3. Turbo"],
            ["4. Imagen3"]
          ],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };
      
      await bot.sendMessage(chatId, 
        "🎨 Select your default model:\n\n" +
        "1. Raider - High Quality, Fast\n" +
        "2. Flux - Balanced quality and speed\n" +
        "3. Turbo - Enhanced detail and creativity (Default)\n" +
        "4. Imagen3 - Google's advanced AI model\n\n" +
        "Reply with a number (1-4)",
        keyboard
      );
    }
    else if (validateCommand(text, "/img") || (message.reply_to_message?.from?.username === BOT_USERNAME)) {
      let prompt = text.replace(/^\/img/i, "").trim();

      if (!prompt) {
        await bot.sendMessage(chatId, 
          "⚠️ Please provide a prompt with your command.\n" +
          "Example: `/img A scenic mountain landscape at sunset`"
        );
        return res.sendStatus(200);
      }

      const userConfig = await UserConfig.findOne({ userId: userInfo.id }) || { defaultModel: MODELS.TURBO };
      const model = userConfig.defaultModel;

      imageGenerationQueue.push({ chatId, prompt, model, userInfo });
      await bot.sendMessage(chatId, 
        `🖼 Image generation queued!\n\n` +
        `Prompt: "${prompt}"\n` +
        `Model: ${modelNames[model]}\n` +
        `Queue position: ${imageGenerationQueue.length}`
      );
      processImageQueue();
    }
    else if (message.reply_to_message?.text?.includes("Select your default model")) {
      const choice = parseInt(text) - 1;
      const models = [MODELS.RAIDER, MODELS.FLUX, MODELS.TURBO, MODELS.IMAGEN3];
      
      if (choice >= 0 && choice < models.length) {
        const selectedModel = models[choice];
        await UserConfig.findOneAndUpdate(
          { userId: userInfo.id },
          { defaultModel: selectedModel },
          { upsert: true }
        );
        
        const modelDescriptions = {
          [MODELS.RAIDER]: "High Quality, Fast",
          [MODELS.FLUX]: "Balanced quality and speed",
          [MODELS.TURBO]: "Enhanced detail and creativity",
          [MODELS.IMAGEN3]: "Google's advanced AI model"
        };
        
        await bot.sendMessage(chatId, 
          `✅ Model updated to: ${modelNames[selectedModel]}\n` +
          `Description: ${modelDescriptions[selectedModel]}\n\n` +
          `Use /img with a prompt to generate images!`
        );
      } else {
        await bot.sendMessage(chatId, "❌ Invalid selection. Please choose a number between 1 and 4.");
      }
    }
  } catch (error) {
    console.error("Command handling error:", error);
    await bot.sendMessage(chatId, "❌ An error occurred. Please try again.");
    io.emit("log", { type: "ERROR", message: error.message, timestamp });
  }

  res.sendStatus(200);
});

// Update the callback query handler
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;

  if (query.data.startsWith('copy_')) {
    const promptId = query.data.replace('copy_', '');
    const prompt = global.promptCache.get(promptId);
    
    if (prompt) {
      // Send prompt as a separate message for easy copying
      await bot.sendMessage(chatId, 
        `\`${prompt}\``,
        { parse_mode: 'Markdown' }
      );
      await bot.answerCallbackQuery(query.id, { text: "Prompt copied! ✨" });
    } else {
      await bot.answerCallbackQuery(query.id, { 
        text: "Sorry, this prompt is no longer available.", 
        show_alert: true 
      });
    }
  }
});

io.on("connection", (socket) => {
  socket.on("adminLogin", async (password) => {
    const isValid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    socket.emit("adminLoginResponse", { success: isValid });
  });

  socket.on("startBot", () => {
    botRunning = true;
    io.emit("log", { type: "INFO", message: "Bot started", timestamp: new Date().toISOString() });
  });

  socket.on("stopBot", () => {
    botRunning = false;
    io.emit("log", { type: "INFO", message: "Bot stopped", timestamp: new Date().toISOString() });
  });

  socket.on("getImageLog", async () => {
    const logs = await ImageLog.find().sort({ timestamp: -1 }).limit(100);
    socket.emit("imageLogHistory", logs);
  });

  socket.on("getUsage", async () => {
    const usage = await Usage.find().sort({ date: 1 }).limit(30);
    socket.emit("usageData", usage);
  });

  socket.on("getUserTraffic", () => {
    socket.emit("userTraffic", { activeUsers: activeUsers.size });
  });

  socket.on("getUserStats", async () => {
    const stats = await UserConfig.find().limit(50);
    socket.emit("userStats", stats);
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});