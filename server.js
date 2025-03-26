require("dotenv").config();
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const { Server } = require("socket.io");
const http = require("http");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 4000;

const bot = new TelegramBot(process.env.BOT_TOKEN);
const WEBHOOK_URL = process.env.WEBHOOK_URL + "/webhook";
const BOT_USERNAME = process.env.BOT_USERNAME || "@YourBotUsername";
const ADMIN_PASSWORD_HASH = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);
const DB_URL = process.env.DB_URL;
const VALID_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "21:9", "9:21"];

const MODELS = {
  RAIDER: "raider",
  FLUX: "flux",
  TURBO: "turbo",
  GEMINI: "gemini"
};

const modelNames = {
  [MODELS.RAIDER]: "Raider",
  [MODELS.FLUX]: "Flux",
  [MODELS.TURBO]: "Turbo",
  [MODELS.GEMINI]: "Gemini Flash 2.0"
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
  defaultModel: { type: String, default: MODELS.FLUX },
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

const tempDir = path.join('public', 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

function cleanupTempFiles() {
  const files = fs.readdirSync(tempDir);
  const now = Date.now();
  files.forEach(file => {
    const filePath = path.join(tempDir, file);
    const stats = fs.statSync(filePath);
    if (now - stats.mtimeMs > 3600000) {
      fs.unlinkSync(filePath);
    }
  });
}

setInterval(cleanupTempFiles, 3600000);

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
  const timestamp = Date.now();
  const randomSeed = Math.floor(Math.random() * 1000000);
  
  const themes = [
    // High-Quality Scenes
    "cinematic cityscape", "golden hour landscape", "dramatic mountain vista", 
    "serene beach sunset", "misty forest morning", "urban street photography",
    "architectural masterpiece", "cozy cafe interior", "luxury penthouse view",
    "historic castle grounds", "modern art gallery", "japanese zen garden",

    // Human-Centric (Professional/Artistic)
    "fashion photography", "street portrait", "dance performance",
    "artist in studio", "chef in kitchen", "musician on stage",
    "athlete in motion", "business professional", "traditional craftsman",
    
    // Modern Urban
    "modern downtown", "rooftop lounge", "subway station",
    "city park spring", "night market", "boutique shop",
    "urban garden", "coffee shop", "art district",
    
    // Nature & Landscapes
    "alpine lake sunrise", "desert oasis", "tropical beach",
    "autumn forest path", "rolling hills", "crystal cave",
    "northern lights", "cherry blossom garden", "waterfall vista",
    
    // Architecture & Interiors
    "modern minimalist", "art deco interior", "gothic cathedral",
    "japanese temple", "scandinavian home", "mediterranean villa",
    "industrial loft", "luxury hotel lobby", "bohemian studio",
    
    // Technology & Future
    "smart city", "tech workspace", "innovation lab",
    "electric vehicle", "sustainable architecture", "digital art gallery",
    "modern laboratory", "space observatory", "green technology"
  ];

  const styles = [
    "cinematic", "photorealistic", "professional photography",
    "editorial", "architectural", "fashion photography",
    "portrait", "landscape", "studio lighting",
    "golden hour", "blue hour", "natural light",
    "high-end commercial", "magazine style", "fine art"
  ];

  const moods = [
    "elegant", "professional", "sophisticated",
    "peaceful", "energetic", "dramatic",
    "warm", "clean", "modern",
    "natural", "refined", "authentic"
  ];

  const timeOfDay = [
    "golden hour", "blue hour", "soft morning light",
    "bright midday", "late afternoon", "twilight",
    "dusk", "night with city lights", "sunrise",
    "sunset", "overcast diffused light"
  ];

  const perspectives = [
    "eye level", "wide angle", "telephoto compression",
    "aerial view", "low angle", "medium shot",
    "close-up detail", "establishing shot", "dutch angle",
    "symmetrical", "leading lines", "rule of thirds"
  ];

  const lighting = [
    "volumetric rays", "quantum luminescence", "temporal glow",
    "dimensional radiance", "synthetic illumination", "neural light",
    "bio-digital emission", "probability shine", "parallel beam",
    
  ];

  const atmospheres = [
    "quantum fog", "temporal mist", "dimensional haze",
    "synthetic atmosphere", "neural cloud", "bio-digital vapor",
    "probability dust", "parallel air", "quantum smoke",
    
  ];

  const textures = [
    "quantum surface", "temporal fabric", "dimensional material",
    "synthetic texture", "neural pattern", "bio-digital surface",
    "probability weave", "parallel structure", "quantum grain",
    
  ];

  const colors = [
    "quantum spectrum", "temporal palette", "dimensional hue",
    "synthetic shade", "neural tint", "bio-digital tone",
    "probability color", "parallel pigment", "quantum chroma",
      
  ];

  const compositions = [
    "quantum balance", "temporal harmony", "dimensional flow",
    "synthetic arrangement", "neural composition", "bio-digital layout",
    "probability design", "parallel structure", "quantum order",
  ];

  const randomTheme = themes[Math.floor(Math.random() * themes.length)];
  const randomStyle = styles[Math.floor(Math.random() * styles.length)];
  const randomMood = moods[Math.floor(Math.random() * moods.length)];
  const randomTime = timeOfDay[Math.floor(Math.random() * timeOfDay.length)];
  const randomPerspective = perspectives[Math.floor(Math.random() * perspectives.length)];
  const randomLighting = lighting[Math.floor(Math.random() * lighting.length)];
  const randomAtmosphere = atmospheres[Math.floor(Math.random() * atmospheres.length)];
  const randomTexture = textures[Math.floor(Math.random() * textures.length)];
  const randomColor = colors[Math.floor(Math.random() * colors.length)];
  const randomComposition = compositions[Math.floor(Math.random() * compositions.length)];

  const systemPrompt = `Create a professional, high-quality image generation prompt combining these elements:
Theme: "${randomTheme}"
Style: "${randomStyle}"
Mood: "${randomMood}"
Time: "${randomTime}"
Perspective: "${randomPerspective}"

Rules:
- Create a clear, specific, and professional description
- Focus on photographic or cinematic quality
- Include specific lighting and atmosphere details
- Add professional photography terms when relevant
- Emphasize composition and visual impact
- Keep descriptions grounded and realistic
- Avoid fantasy or surreal elements unless specifically requested
- Include technical details that enhance image quality
- Focus on creating magazine-quality visuals
- When including people, focus on professional or artistic contexts

The prompt should read as a professional photography or cinematography direction.`;
  
  try {
    // First try with Gemini API 1
    try {
      const model = genAI1.getGenerativeModel({ model: "gemini-2.0-flash" });
      const result = await model.generateContent(systemPrompt);
      return result.response.text().trim();
    } catch (error) {
      console.error("First Gemini API key failed:", error);
      
      // Second try with Gemini API 2
      try {
      const model = genAI2.getGenerativeModel({ model: "gemini-2.0-flash" });
      const result = await model.generateContent(systemPrompt);
      return result.response.text().trim();
      } catch (error) {
        console.error("Second Gemini API key failed:", error);
        
        // Fallback to Pollinations text API
        const response = await axios.post('https://text.pollinations.ai/', {
          messages: [
            {
              role: "system",
              content: systemPrompt
            },
            {
              role: "user",
              content: "Generate a unique image prompt"
            }
          ],
          model: "mistral",
          private: true,
          seed: randomSeed
        });
        
        return response.data.trim();
      }
    }
  } catch (error) {
    console.error("All prompt generation methods failed:", error);
    throw new Error("Failed to generate random prompt. Please try again.");
  }
}

async function generateImage(prompt, model = MODELS.FLUX, aspectRatio = "1:1") {
  try {
    const seed = Math.floor(Math.random() * 999999) + 1;
    
    if (model === MODELS.GEMINI) {
      try {
        const model = genAI1.getGenerativeModel({
          model: "gemini-2.0-flash-exp-image-generation",
          generationConfig: {
            responseModalities: ['Text', 'Image']
          },
        });

        const result = await model.generateContent(`Generate an image for this prompt: ${prompt}`);
        
        for (const part of result.response.candidates[0].content.parts) {
          if (part.inlineData) {
            const fileName = `gemini-${Date.now()}-${Math.random().toString(36).substring(7)}.png`;
            const filePath = path.join(tempDir, fileName);
            
            const imageBuffer = Buffer.from(part.inlineData.data, 'base64');
            fs.writeFileSync(filePath, imageBuffer);
            
            return `${process.env.WEBHOOK_URL}/temp/${fileName}`;
          }
        }
        throw new Error("No image generated by Gemini");
      } catch (error) {
        console.error("Gemini image generation failed:", error);
        throw error;
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
          throw error;
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
• Raider - Balanced quality and speed
• Flux - High Quality, Fast (Default)
• Turbo - Enhanced detail and creativity
• Gemini Flash - Google's advanced AI model

Example usage: "/img A majestic castle in the clouds"
`;

const validateCommand = (text, command) => {
  return text.startsWith(command) || 
    (text.startsWith("/") && text.startsWith(command.slice(1), 1));
};

app.get("/test", (req, res) => {
  try {
    res.json({
      status: "success",
      message: "API is working",
      timestamp: new Date().toISOString(),
      botStatus: botRunning ? "active" : "inactive",
      queueSize: imageGenerationQueue.length
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      timestamp: new Date().toISOString()
    });
  }
});

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
      const userConfig = await UserConfig.findOne({ userId: userInfo.id }) || { defaultModel: MODELS.FLUX };
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
        const userConfig = await UserConfig.findOne({ userId: userInfo.id }) || { defaultModel: MODELS.FLUX };
        let model = userConfig.defaultModel;
        
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
            ["4. Gemini Flash"]
          ],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };
      
      await bot.sendMessage(chatId, 
        "🎨 Select your default model:\n\n" +
        "1. Raider - Balanced quality and speed\n" +
        "2. Flux - High Quality, Fast (Default)\n" +
        "3. Turbo - Enhanced detail and creativity\n" +
        "4. Gemini Flash - Google's advanced AI model\n\n" +
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

      const userConfig = await UserConfig.findOne({ userId: userInfo.id }) || { defaultModel: MODELS.FLUX };
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
      const models = [MODELS.RAIDER, MODELS.FLUX, MODELS.TURBO, MODELS.GEMINI];
      
      if (choice >= 0 && choice < models.length) {
        const selectedModel = models[choice];
        await UserConfig.findOneAndUpdate(
          { userId: userInfo.id },
          { defaultModel: selectedModel },
          { upsert: true }
        );
        
        const modelDescriptions = {
          [MODELS.RAIDER]: "Balanced quality and speed",
          [MODELS.FLUX]: "High Quality, Fast",
          [MODELS.TURBO]: "Enhanced detail and creativity",
          [MODELS.GEMINI]: "Google's advanced AI model"
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