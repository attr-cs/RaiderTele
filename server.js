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
    "modern laboratory", "space observatory", "green technology",

    // Ancient Indian & Hindu Themes
    "ancient vedic ceremony", "rishis meditating in himalayas", "temple architecture",
    "krishna's divine garden", "ancient gurukul", "sacred river ganges",
    "ayodh-ya palace", "himalayan ashram", "ancient sanskrit library",
    "meditation caves", "sacred banyan tree", "temple courtyard",
    
    // Natural Wonders
    "himalayan peaks sunrise", "kerala backwaters", "rajasthan desert",
    "valley of flowers", "sundarbans mangrove", "western ghats monsoon",
    "ladakh monastery", "varanasi ghats", "konark sun temple",
    
    // Cultural Heritage
    "classical dance performance", "traditional artisan workshop", "ancient marketplace",
    "royal durbar hall", "traditional spice market", "temple festival",
    "classical music concert", "traditional weaver's studio", "ancient astronomical observatory",
    
    // Modern India
    "modern mumbai skyline", "tech hub bangalore", "delhi metro station",
    "contemporary art gallery", "fusion restaurant", "urban garden",
    
    // Nostalgic Scenes
    "vintage railway station", "old haveli courtyard", "traditional village life",
    "ancient stepwell", "heritage street", "traditional pottery workshop",
    
    // Epic Scenes
    "kurukshetra battlefield", "ram setu sunrise", "ancient ayodhya",
    "dwaraka kingdom", "himalayan meditation cave", "sacred forest ashram",

    // Ancient Civilizations
    "mesopotamian ziggurat", "egyptian temple complex", "roman forum at dawn",
    "mayan pyramid ceremony", "angkor wat sunrise", "petra treasury night",
    "ancient chinese palace", "greek acropolis sunset", "persian gardens",
    "viking longship harbor", "aztec temple market", "celtic stone circle",

    // Indian Classical
    "ajanta caves artwork", "ellora temple complex", "thanjavur palace",
    "hampi ruins sunset", "khajuraho temples", "badami cave temples",
    "mahabalipuram shore temple", "golden temple amritsar", "mysore palace diwali",
    "fatehpur sikri court", "amber fort jaipur", "meenakshi temple madurai",

    // Sacred & Spiritual
    "kailash mansarovar", "kedarnath temple snow", "badrinath peaks",
    "jagannath puri temple", "tirupati temple dawn", "somnath temple sunset",
    "rameshwaram corridors", "kashi vishwanath ghat", "bodh gaya morning",
    "haridwar aarti ceremony", "rishikesh ashram", "belur math architecture",

    // Modern Architectural Marvels
    "burj khalifa twilight", "singapore gardens night", "dubai future city",
    "shanghai skyscraper reflections", "tokyo tower rain", "sydney opera house dawn",
    "manhattan aerial sunset", "london shard fog", "moscow city lights",
    "toronto cn tower aurora", "hong kong harbor night", "doha skyline dusk",

    // Natural Phenomena
    "aurora borealis iceland", "sahara desert stars", "great barrier reef",
    "grand canyon lightning", "mount everest sunrise", "victoria falls rainbow",
    "pamukkale thermal pools", "zhangjiajie peaks mist", "antelope canyon light",
    "iceland black beach", "norwegian fjords", "swiss alps glacier",

    // Cultural Heritage
    "japanese tea ceremony", "venetian carnival", "moroccan souk",
    "turkish grand bazaar", "chinese lantern festival", "thai songkran",
    "rio carnival parade", "spanish flamenco", "african tribal ceremony",
    "mongolian eagle hunters", "tibetan butter festival", "irish celtic celebration",

    // Contemporary Urban
    "seoul digital district", "melbourne street art", "berlin wall gallery",
    "amsterdam canal homes", "prague old town square", "kyoto modern contrast",
    "barcelona gothic quarter", "san francisco fog", "chicago river walk",
    "copenhagen bicycle culture", "vienna coffee house", "lisbon tram street",

    // Industrial & Scientific
    "nasa launch facility", "CERN particle detector", "robotics laboratory",
    "hydroelectric dam", "solar farm aerial", "wind turbine farm sunset",
    "submarine dock facility", "aircraft carrier deck", "space station module",
    "quantum computer lab", "fusion reactor core", "deep sea research station",

    // Traditional Arts
    "kabuki theater performance", "kathakali dancer", "beijing opera",
    "ballet rehearsal studio", "symphony orchestra", "glass blowing workshop",
    "marble sculpture studio", "woodblock printing", "ceramic pottery wheel",
    "weaving loom workshop", "metalsmith forge", "calligraphy master",

    // Modern Art & Design
    "contemporary art gallery", "fashion runway show", "design studio workspace",
    "modern dance performance", "digital art installation", "architectural model room",
    "photography darkroom", "recording studio session", "film set lighting",
    "virtual reality lab", "3D printing facility", "motion capture studio",

    // Historical Moments
    "silk road caravan", "medieval tournament", "renaissance workshop",
    "industrial revolution factory", "1920s jazz club", "1950s diner",
    "ancient olympic games", "samurai dojo", "victorian conservatory",
    "colonial trading port", "wild west saloon", "art deco cinema",

    // Futuristic
    "vertical farm interior", "hyperloop station", "quantum city",
    "mars colony dome", "underwater metropolis", "floating sky city",
    "hologram market", "anti-gravity park", "space elevator base",
    "fusion powered city", "bio-luminescent architecture", "nanotech laboratory",

    // Intimate Spaces
    "artisan coffee roastery", "vintage bookstore", "secret garden",
    "greenhouse conservatory", "artist's loft", "watchmaker's workshop",
    "perfume laboratory", "chocolatier kitchen", "violin maker's studio",
    "botanical research lab", "vintage camera shop", "traditional barbershop",

    // Epic Landscapes
    "himalayan monastery", "amazon rainforest canopy", "mongolian steppes",
    "scottish highlands", "new zealand fjords", "indonesian volcanos",
    "namibian desert", "canadian rockies", "patagonian peaks",
    "arctic ice caves", "brazilian waterfalls", "australian outback",

    // Ancient Indian Epics & Mythology
    "krishna's raas leela", "hanuman carrying mountain", "arjuna's archery",
    "rama's coronation", "vishnu on sheshnag", "shiva's meditation",
    "ganga's descent", "buddha's enlightenment", "ashoka's court",
    "chandragupta's durbar", "nalanda university", "takshashila campus",

    // Sacred Architecture
    "kailasa temple ellora", "brihadeshwara dawn", "konark wheel detail",
    "martand sun temple", "dilwara marble work", "aihole temples",
    "pattadakal complex", "modhera sun steps", "sanchi stupa sunrise",
    "elephanta caves", "lepakshi pillars", "vittala temple hampi",

    // Traditional Sciences
    "ancient observatory", "ayurvedic garden", "vedic mathematics class",
    "astronomical instruments", "traditional metallurgy", "ancient surgical tools",
    "water harvesting system", "ancient textile workshop", "medicinal herb garden",

    // Modern Masterpieces
    "lotus temple dusk", "akshardham reflection", "bandra worli sea link",
    "howrah bridge fog", "metro art station", "cyber hub gurgaon",
    "international airport terminal", "modern museum interior", "tech park sunrise",

    // [... hundreds more themes organized by category ...]
  ];

  const styles = [
    "cinematic", "photorealistic", "professional photography",
    "editorial", "architectural", "fashion photography",
    "portrait", "landscape", "studio lighting",
    "golden hour", "blue hour", "natural light",
    "high-end commercial", "magazine style", "fine art",
    "ultra realistic", "photorealistic 8k", "cinematic 8k",
    "professional photography", "national geographic", "architectural photography",
    "documentary style", "fine art", "editorial photography",
    "hyperrealistic", "cinematic anamorphic", "medium format film",
    "large format photography", "documentary", "fashion editorial",
    "architectural digest", "fine art portrait", "commercial advertising",
    "product photography", "street photography"
  ];

  const moods = [
    "elegant", "professional", "sophisticated",
    "peaceful", "energetic", "dramatic",
    "warm", "clean", "modern",
    "natural", "refined", "authentic",
    "serene", "mystical", "timeless", "majestic", "ethereal",
    "peaceful", "dramatic", "nostalgic", "contemplative", "divine",
    "contemplative", "awe-inspiring", "transcendent", "harmonious", "dynamic",
    "intimate", "grandiose", "vibrant", "meditative", "energetic",
    "tranquil", "majestic", "nostalgic", "timeless", "mysterious",
    "powerful", "serene"
  ];

  const timeOfDay = [
    "golden hour", "blue hour", "soft morning light",
    "bright midday", "late afternoon", "twilight",
    "dusk", "night with city lights", "sunrise",
    "sunset", "overcast diffused light",
    "pre-dawn glow", "first light", "morning mist",
    "harsh noon", "afternoon haze", "golden hour",
    "blue moment", "astronomical twilight", "starlit night",
    "moonlit evening", "storm approaching", "rainbow after rain"
  ];

  const perspectives = [
    "eye level", "wide angle", "telephoto compression",
    "aerial view", "low angle", "medium shot",
    "close-up detail", "establishing shot", "dutch angle",
    "symmetrical", "leading lines", "rule of thirds",
    "macro detail", "extreme close-up", "intimate portrait",
    "environmental portrait", "establishing shot", "aerial drone",
    "worm's eye", "bird's eye", "over-the-shoulder",
    "split-level", "through-the-window", "reflection shot",
    "silhouette", "framed composition", "layered depth"
  ];

  const lighting = [
    "golden hour", "morning rays", "divine light", "natural sunlight",
    "dramatic shadows", "soft diffused", "atmospheric", "rim lighting",
    "volumetric light", "celestial glow",
    "chiaroscuro", "rembrandt lighting", "split lighting",
    "backlit rim light", "soft box diffused", "natural window light",
    "dramatic spotlighting", "ambient fill", "practical lighting",
    "bounce light", "colored gel effect", "light painting"
  ];

  const atmospheres = [
    "quantum fog", "temporal mist", "dimensional haze",
    "synthetic atmosphere", "neural cloud", "bio-digital vapor",
    "probability dust", "parallel air", "quantum smoke",
    "morning fog", "desert heat wave", "ocean spray",
    "mountain clarity", "urban smog", "rain mist",
    "dust particles", "steam effect", "smoke tendrils",
    "clear crisp air", "humid tropical", "winter frost"
  ];

  const textures = [
    "quantum surface", "temporal fabric", "dimensional material",
    "synthetic texture", "neural pattern", "bio-digital surface",
    "probability weave", "parallel structure", "quantum grain",
    "polished marble", "rough stone", "weathered wood",
    "hammered metal", "woven fabric", "rippled water",
    "frosted glass", "rusted iron", "smooth leather",
    "raw concrete", "brushed steel", "organic moss"
  ];

  const colors = [
    "quantum spectrum", "temporal palette", "dimensional hue",
    "synthetic shade", "neural tint", "bio-digital tone",
    "probability color", "parallel pigment", "quantum chroma",
    "golden hour warmth", "twilight blue", "emerald depths",
    "autumn palette", "desert neutrals", "ocean tones",
    "forest greens", "urban greys", "sunset spectrum",
    "morning pastels", "dramatic contrasts", "muted earth tones"
  ];

  const compositions = [
    "quantum balance", "temporal harmony", "dimensional flow",
    "synthetic arrangement", "neural composition", "bio-digital layout",
    "probability design", "parallel structure", "quantum order",
    "golden ratio", "dynamic symmetry", "triangular balance",
    "leading lines", "frame within frame", "natural framing",
    "rule of odds", "diagonal flow", "circular motion",
    "layered foreground", "depth stacking", "negative space"
  ];

  const qualityEnhancements = [
    "8K resolution", "ultra-detailed", "photorealistic", "high dynamic range",
    "sharp focus", "crystal clear", "professional grade", "masterfully composed",
    "studio quality", "magazine quality",
    "16K resolution", "RAW quality", "ultra-detailed textures",
    "perfect focus stacking", "extreme dynamic range", "zero noise",
    "perfect exposure", "color accuracy", "tack sharp details",
    "medium format quality", "cinematic color grading", "professional retouching"
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
  const randomQuality = qualityEnhancements[Math.floor(Math.random() * qualityEnhancements.length)];

  const systemPrompt = `Create a single high-quality image generation prompt.
Theme: "${randomTheme}"
Style: "${randomStyle}"
Mood: "${randomMood}"
Lighting: "${randomLighting}"
Quality: "${randomQuality}"

Rules:
- Return ONLY the final prompt text
- Focus on photorealistic quality and rich details
- Include specific lighting and atmosphere
- Keep descriptions clear and impactful
- Emphasize professional photography elements
- Add technical quality terms (8K, ultra-detailed, etc.)
- Make each prompt unique and specific
- Maintain realism and authenticity
- Create magazine-worthy descriptions

Example format: "Ultra-detailed 8K photograph of [scene description], [lighting details], [atmosphere], [technical aspects], photorealistic quality"`;
  
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