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
const ADMIN_PASSWORD_HASH = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);
const DB_URL = process.env.DB_URL;
const VALID_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "21:9", "9:21"];

const MODELS = {
  RAIDER: "raider",
  FLUX: "flux",
  TURBO: "turbo"
};

const modelNames = {
  [MODELS.RAIDER]: "Raider",
  [MODELS.FLUX]: "Flux",
  [MODELS.TURBO]: "Turbo"
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
    // Sci-Fi Themes
    "cyberpunk metropolis", "space station", "mars colony", "quantum laboratory", 
    "android factory", "neon slums", "hologram market", "orbital habitat",
    "cyborg workshop", "laser highway", "plasma foundry", "zero gravity garden",
    "robot repair shop", "data center", "virtual reality hub", "clone facility",
    "alien embassy", "tech noir alley", "solar sail port", "asteroid mining base",

    // Urban/Modern Themes
    "subway platform", "rooftop garden", "street food market", "urban farm",
    "construction site", "shopping arcade", "parking garage", "office lobby",
    "metro station", "city intersection", "food court", "urban decay",
    "apartment complex", "highway overpass", "billboard jungle", "power plant",
    "container port", "train yard", "bus terminal", "industrial zone",

    // Historical Themes
    "victorian factory", "medieval workshop", "ancient marketplace", "roman bath",
    "renaissance studio", "viking shipyard", "aztec temple", "persian palace",
    "egyptian tomb", "celtic forge", "japanese castle", "silk road bazaar",
    "colonial port", "wild west saloon", "monastery library", "pirate cove",
    "feudal farm", "nomad camp", "tribal village", "ancient observatory",

    // Industrial/Mechanical
    "clockwork factory", "steam engine room", "gear workshop", "furnace chamber",
    "assembly line", "mechanical laboratory", "turbine hall", "control room",
    "boiler room", "machine shop", "foundry floor", "conveyor system",
    "hydraulic plant", "testing facility", "maintenance bay", "welding station",
    "robotic assembly", "quality control", "parts warehouse", "repair dock",

    // Abstract/Surreal
    "impossible geometry", "dream corridor", "memory palace", "thought bubble",
    "consciousness stream", "parallel dimension", "time spiral", "reality fold",
    "mind maze", "quantum realm", "abstract plane", "void space",
    "neural network", "dimensional rift", "paradox chamber", "infinity loop",
    "reality glitch", "memory fragment", "dream sequence", "consciousness cloud",

    // Architecture
    "brutalist complex", "glass skyscraper", "floating pavilion", "underground bunker",
    "eco-building", "vertical farm", "solar tower", "wind turbine field",
    "geodesic dome", "bamboo structure", "desert architecture", "ice hotel",
    "treehouse city", "cave dwelling", "floating market", "suspended bridge",
    "mountain monastery", "underwater hotel", "desert oasis", "cloud platform",

    // Natural/Landscape
    "volcanic crater", "ice canyon", "salt flat", "coral reef",
    "desert dunes", "mountain peak", "tidal pool", "geothermal spring",
    "crystal cave", "rock formation", "glacial lake", "sandstone arch",
    "limestone karst", "basalt column", "meteor crater", "fossil bed",
    "granite cliff", "mud volcano", "geyser field", "stone forest",

    // Cultural/Social
    "tea ceremony", "street festival", "night market", "public square",
    "outdoor cinema", "street performance", "food stall", "craft workshop",
    "farmers market", "street parade", "art installation", "public garden",
    "street carnival", "outdoor concert", "sports event", "protest march",
    "religious ceremony", "cultural celebration", "street fair", "public gathering",

    // Transportation
    "hyperloop station", "flying car port", "magnetic railway", "drone hub",
    "airship dock", "submarine pen", "rocket launch pad", "hover vehicle depot",
    "teleport chamber", "gravity train", "space elevator", "wormhole gate",
    "quantum transport", "time machine lab", "interdimensional port", "telekinetic transit",
    "matter transmitter", "vacuum tube system", "levitation platform", "portal nexus",

    // Professional/Work
    "research laboratory", "surgical theater", "broadcast studio", "recording booth",
    "artist workshop", "design studio", "engineering lab", "science facility",
    "weather station", "mission control", "command center", "observation post",
    "testing chamber", "clean room", "data center", "server farm",
    "greenhouse complex", "hydroponics bay", "gene lab", "quantum computer facility",

    // Sci-Fi Advanced
    "quantum computing facility", "nanite assembly plant", "AI consciousness hub", 
    "biomechanical garden", "synthetic evolution lab", "time dilation chamber",
    "antimatter reactor", "neural interface clinic", "memory extraction lab",
    "consciousness upload center", "synthetic biology lab", "quantum entanglement node",
    
    // Urban Evolution
    "vertical megacity", "smart city hub", "autonomous vehicle depot",
    "urban farming tower", "waste recycling complex", "energy harvesting district",
    "digital advertising canyon", "urban air mobility port", "underground eco-habitat",
    "climate-controlled biodome", "urban water purification plant",
    
    // Historical Depth
    "sumerian marketplace", "phoenician harbor", "babylonian gardens",
    "mayan observatory", "incan terrace farm", "mongol war camp",
    "byzantine workshop", "ottoman palace", "mughal court", "polynesian settlement",
    
    // Future Architecture
    "self-healing building", "living architecture hub", "morphing structure",
    "weather-responsive facade", "bio-luminescent building", "gravity-defying construction",
    "shape-shifting apartment", "environmental adaptation center",
    
    // Advanced Transportation
    "quantum teleportation hub", "consciousness transfer station", "time travel depot",
    "dimensional gateway", "neural network transit", "thought travel terminal",
    "bioorganic vehicle hub", "antimatter drive dock", "zero-point energy port",
    
    // Specialized Facilities
    "memory crystal archive", "dream recording studio", "emotion harvesting plant",
    "consciousness backup facility", "synthetic reality lab", "quantum probability center",
    "parallel universe observatory", "temporal paradox research lab",
    
    // Natural Evolution
    "bioluminescent ecosystem", "floating crystal forest", "living metal canyon",
    "quantum crystal cave", "temporal coral reef", "gravity-warped landscape",
    "plasma storm field", "dimensional fracture zone", "reality distortion valley",
    
    // Cultural Fusion
    "cyber-shamanic temple", "techno-organic bazaar", "bio-digital festival",
    "quantum cultural center", "neural art gallery", "memory culture museum",
    "synthetic tradition hub", "hybrid ritual space", "digital ceremony chamber",
    
    
  ];

  const styles = [
    "photorealistic", "oil painting", "watercolor", "digital art", "pencil sketch",
    "charcoal drawing", "3D render", "concept art", "vintage photograph", "anime style",
    "comic book art", "propaganda poster", "technical diagram", "architectural rendering",
    "isometric design", "pixel art", "synthwave", "vaporwave", "minimalist", "baroque",
    "holographic projection", "quantum visualization", "neural network art",
    "bio-organic rendering", "temporal distortion", "dimensional shift",
    "reality glitch", "consciousness stream", "memory crystal",
    "synthetic dreams", "quantum impressionism", "neural abstract",
    "bio-digital fusion", "temporal watercolor", "quantum oil painting",
    
  ];

  const moods = [
    "dystopian", "optimistic", "mysterious", "peaceful", "chaotic",
    "industrial", "serene", "tense", "nostalgic", "futuristic",
    "abandoned", "bustling", "isolated", "harmonious", "clinical",
    "decaying", "pristine", "weathered", "sterile", "organic",
    "quantum uncertain", "temporally displaced", "dimensionally shifted",
    "consciously evolving", "synthetically alive", "neurally connected",
    "bio-digitally fused", "reality warped", "probability shifted",
    "quantum entangled", "temporally paradoxical", "dimensionally aware",
    
  ];

  const timeOfDay = [
    "dawn", "morning", "noon", "afternoon", "dusk",
    "twilight", "night", "midnight", "golden hour", "blue hour",
    "quantum midnight", "temporal noon", "dimensional dawn",
    "synthetic sunset", "neural twilight", "bio-digital morning",
    "probability dusk", "parallel dawn", "quantum gloaming",
    "temporal witching hour", "dimensional zenith", "synthetic nadir",
    
  ];

  const perspectives = [
    "bird's eye view", "worm's eye view", "isometric", "first person",
    "wide angle", "telephoto", "macro", "panoramic", "dutch angle",
    "overhead shot", "low angle", "eye level", "three-quarter view",
    "quantum perspective", "temporal view", "dimensional angle",
    "synthetic vision", "neural sight", "bio-digital lens",
    "probability frame", "parallel view", "quantum focus",
    "temporal parallax", "dimensional shift", "synthetic depth",
    
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

  const systemPrompt = `Create a single detailed image generation prompt combining these elements:
Theme: "${randomTheme}"
Style: "${randomStyle}"
Mood: "${randomMood}"
Time: "${randomTime}"
Perspective: "${randomPerspective}"
Lighting: "${randomLighting}"
Atmosphere: "${randomAtmosphere}"
Texture: "${randomTexture}"
Color: "${randomColor}"
Composition: "${randomComposition}"

Rules:
- Return ONLY the prompt text with no explanations or formatting
- Be specific and detailed but concise (max 3-4 sentences)
- Focus on visual elements, composition, and atmosphere
- Include specific lighting, colors, and textures
- Add unique details that make the scene memorable
- NO generic fantasy elements or clichés
- NO explanatory text or meta-commentary
- Avoid overused AI art tropes and descriptions
- Naturally blend all elements into a cohesive description
- Create unexpected and interesting combinations

The prompt should read as one cohesive description that naturally incorporates all elements.`;
  
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
    
    if (model === MODELS.RAIDER) {
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
            ["3. Turbo"]
          ],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };
      
      await bot.sendMessage(chatId, 
        "🎨 Select your default model:\n\n" +
        "1. Raider - Balanced quality and speed\n" +
        "2. Flux - High Quality, Fast (Default)\n" +
        "3. Turbo - Enhanced detail and creativity\n\n" +
        "Reply with a number (1-3)",
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
      const models = [MODELS.RAIDER, MODELS.FLUX, MODELS.TURBO];
      
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
          [MODELS.TURBO]: "Enhanced detail and creativity"
        };
        
        await bot.sendMessage(chatId, 
          `✅ Model updated to: ${modelNames[selectedModel]}\n` +
          `Description: ${modelDescriptions[selectedModel]}\n\n` +
          `Use /img with a prompt to generate images!`
        );
      } else {
        await bot.sendMessage(chatId, "❌ Invalid selection. Please choose a number between 1 and 3.");
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