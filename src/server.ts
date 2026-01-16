import express from 'express';
import * as bodyParser from 'body-parser';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import {OpenAI} from "openai";
import {GoogleGenerativeAI} from "@google/generative-ai";
import multer from 'multer';
import sharp from 'sharp';
import {OpenRouter} from "@openrouter/sdk";
import {ChatMessageContentItemText, ChatResponseChoice, Message} from "@openrouter/sdk/models";

require('dotenv').config({ override: true });

// Multer storage configuration for texture uploads
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    }
});

const app = express();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

let openRouterModel = "x-ai/grok-4.1-fast";
const openRouter = new OpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
});

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const geminiModel = genAI.getGenerativeModel({model: "gemini-2.5-flash"});
const geminiImageModel = genAI.getGenerativeModel({model: "gemini-2.0-flash-exp"});

// VRChat Dynamic Texture System
interface TextureEntry {
    id: number;           // Stable ID that never changes
    url: string;          // URL to the texture file
    normalUrl?: string;   // URL to the normal map
    smoothnessUrl?: string; // URL to the smoothness map
}

interface WorldState {
    textures: TextureEntry[];  // Array of textures (most recent first)
    selectedId: number;        // Which texture ID is selected for applying
    nextId: number;            // Next ID to assign
    maxTextures: number;
}

const worldState: WorldState = {
    textures: [],
    selectedId: -1,
    nextId: 1,
    maxTextures: 20
};

app.use(bodyParser.json());
app.use(express.static('public'));

// Add this new route to serve ACME challenge files
app.use('/.well-known/acme-challenge', express.static('/var/www/html/.well-known/acme-challenge', {
    setHeaders: (res, _) => {
        res.type('text/plain');
    }
}));

// SSL/TLS options (update with your own key and certificate paths)
const options = {
    key: fs.readFileSync('/etc/letsencrypt/live/ai.seamen.love/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/ai.seamen.love/fullchain.pem')
};

const fixedPromptParts = {
    dare: "Generate a dare prompt for a social drinking game of spin the bottle.",
    truth: "Generate a truth prompt for a social drinking game of spin the bottle.",
    drink: "Generate a drink prompt for a social drinking game of spin the bottle. Don't always tell the user to finish a large amount of the drink.",
    table: "Generate a drink prompt for a social drinking game of spin the table. Don't tell the user to drink too much."
};

//const originPrompt: string = "You are a spin the bottle prompt generator, no singing, keep it in mind that the person that was randomly selected is the one doing the action, keep it less than 12 words, keep in mind this will be in a VR game called VRCHAT, and also, like dont be cringe dude. Only generate 1 option per message. Don't mention spin the bottle.";
const originPrompt: string = "You are a spin the bottle prompt generator, no singing, keep it in mind that the person that was randomly selected is the one doing the action, keep it less than 12 words per response, keep in mind this will be in a VR game called VRCHAT, and also, like dont be cringe dude. Don't mention spin the bottle, dare, or truth. Do not use any asterisk or emojis in the responses.";

let currentDarePrompt = '';
let currentTruthPrompt = '';
let currentDrinkPrompt = '';
let currentTablePrompt = '';
let promptAmount = 10;

//toggles
let isNight = false;
const UseGemini = true;

async function generatePromptsOpenRouter(prompts: string[], amount: number): Promise<string[]> {
    try {
        let res: string[] = [];
        for (let i = 0; i < prompts.length; i++) {
            let messages : Message[] = [{
                role: 'system',
                content: originPrompt,
            },
            {
                role: "user",
                content: "Generate " + amount + " prompts, separated by a semicolon. Make the prompts relating to: " + prompts[i]
            }];

            messages = await sendOpenRouterMessage(messages);
            let ret = messages.pop();
            (ret.content as string).split(';').forEach(m => {
                console.log("Received message: " + m);
                res.push(m);
            })

            /*

            for (let j = 0; j < amount; j++) {
                messages.push({
                    role: 'user',
                    content: prompts[i]
                });

                console.log("Sending message: " + prompts[i]);
                if (prompts[i] == undefined) {
                    continue;
                }
                messages = await sendOpenRouterMessage(messages);
            }

            messages.filter((m) => m.role != 'user' && m.role != 'system').forEach((m) => {
                console.log("Received message: " + m.content);
                res.push(m.content as string)
            });

            */
        }

        return res;
    }
    catch (error) {
        console.error('Error generating prompt:', error);
        return [];
    }
}

async function sendOpenRouterMessage(chat: Message[] = []): Promise<Message[]> {
    const text = await openRouter.chat.send({
        model: openRouterModel,
        messages: chat
    });
    chat = text.choices.map(c => c.message);
    return chat;
}

async function generatePromptsGemini(prompts: string[], amount: number): Promise<string[]> {
    try {
        let res: string[] = [];
        for (let i = 0; i < prompts.length; i++) {
            var chat = geminiModel.startChat();
            await chat.sendMessage(originPrompt);
            for (let j = 0; j < amount; j++) {
                var messageRes = await chat.sendMessage(prompts[i]);
                res.push(messageRes.response.text());
            }
        }

        console.log(res);
        return res;
    } catch (error) {
        console.error('Error generating prompt:', error);
        return [];
    }
}

async function generatePrompt(prompt: string): Promise<string> {
    try {
        const completion = await openai.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: 'You are the one with the best drinking games, no singing, keep it in mind that the person that is spinning is the one doing the action, keep it less than 12 words, keep in mind this will be in a VR game called VRCHAT, and also, like dont be cringe dude.'
                },
                {role: 'user', content: prompt},
            ],
            model: 'gpt-4o-mini',
        });
        if (completion == null || completion.choices.length == 0 || completion.choices[0].message == null || completion.choices[0].message.content == null) {
            return '';
        }
        return completion.choices[0].message.content.trim();
    } catch (error) {
        console.error('Error generating prompt:', error);
        return '';
    }
}

async function generatePrompts(prompts: string[], amount: number): Promise<string[]> {
    return await generatePromptsOpenRouter(prompts, amount);
    /*
    if (UseGemini) {
        return await generatePromptsGemini(prompts, amount);
    }

    let res: string[] = [];
    for (let j = 0; j < prompts.length; j++) {
        console.log("Genering prompts for: " + prompts[j]);
        for (let i = 0; i < amount; i++) {
            res.push(await generatePrompt(prompts[j]));
        }
    }
    return res;
     */
}

async function saveCsv(filename: string, data: string) {
    fs.writeFileSync(filename + '.csv', data, 'utf8')
    console.log(filename + ' file saved successfully');
}

async function generateAndSavePrompts(prompts: string[], filename: string, amount: number) {
    let res = (await generatePrompts(prompts, amount)).join('|');
    saveCsv(filename, res);
    return res;
}

// Selection Ping - No longer needed, wand just applies directly
app.get('/api/select', (_, res) => {
    res.json({ success: true });
});

// Get all textures and current selection (Used by Phone Website)
app.get('/api/status', (_, res) => {
    res.json({
        textures: worldState.textures,
        selectedId: worldState.selectedId
    });
});

// Select which texture to apply (Used by Phone Website)
app.post('/api/select_texture', (req, res) => {
    const { id } = req.body;
    
    const texture = worldState.textures.find(t => t.id === id);
    if (!texture) {
        return res.status(400).json({ error: "Invalid texture id" });
    }
    
    worldState.selectedId = id;
    console.log(`[Texture] Selected texture ID: ${id}`);
    
    res.json({ success: true, selectedId: id });
});

// Serve current selected texture at fixed URL (Used by VRChat)
app.get('/textures/current.png', (req, res) => {
    const currentTexture = worldState.textures.find(t => t.id === worldState.selectedId);
    
    if (!currentTexture) {
        return res.status(404).send('No texture selected');
    }
    
    // Extract filename from URL and serve the file
    const filename = currentTexture.url.split('/').pop();
    const filepath = `public/textures/${filename}`;
    
    if (fs.existsSync(filepath)) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Content-Type', 'image/png');
        res.sendFile(filepath, { root: '.' });
    } else {
        res.status(404).send('Texture file not found');
    }
});

// World State (Used by VRChat polling)
app.get('/api/world_state', (_, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    res.json({
        textures: worldState.textures,  // Array of {id, url}
        selectedId: worldState.selectedId,
        textureCount: worldState.textures.length
    });
});

// Serve normal map by ID
app.get('/textures/normal/:id.png', (req, res) => {
    const id = parseInt(req.params.id);
    console.log(`[Normal] Request for ID: ${id}`);
    const texture = worldState.textures.find(t => t.id === id);
    console.log(`[Normal] Looking for ID ${id}, found texture:`, texture ? JSON.stringify(texture) : 'null');
    
    if (!texture || !texture.normalUrl) {
        return res.status(404).send('Normal map not found - texture has no normalUrl');
    }
    
    const filename = texture.normalUrl.split('/').pop();
    const filepath = `public/textures/${filename}`;
    console.log(`[Normal] Serving file: ${filepath}`);
    
    if (fs.existsSync(filepath)) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Content-Type', 'image/png');
        res.sendFile(filepath, { root: '.' });
    } else {
        res.status(404).send('Normal map file not found on disk: ' + filepath);
    }
});

// Serve smoothness map by ID
app.get('/textures/smoothness/:id.png', (req, res) => {
    const id = parseInt(req.params.id);
    console.log(`[Smooth] Request for ID: ${id}`);
    const texture = worldState.textures.find(t => t.id === id);
    console.log(`[Smooth] Looking for ID ${id}, found texture:`, texture ? JSON.stringify(texture) : 'null');
    
    if (!texture || !texture.smoothnessUrl) {
        return res.status(404).send('Smoothness map not found - texture has no smoothnessUrl');
    }
    
    const filename = texture.smoothnessUrl.split('/').pop();
    const filepath = `public/textures/${filename}`;
    console.log(`[Smooth] Serving file: ${filepath}`);
    
    if (fs.existsSync(filepath)) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Content-Type', 'image/png');
        res.sendFile(filepath, { root: '.' });
    } else {
        res.status(404).send('Smoothness map file not found on disk: ' + filepath);
    }
});

// Serve texture by ID (for VRChat to download specific textures)
// This route must come AFTER normal/smoothness routes since :id matches anything
app.get('/textures/id/:id.png', (req, res) => {
    const id = parseInt(req.params.id);
    
    // If it parsed as NaN, it's probably a _normal or _smoothness request that failed
    if (isNaN(id)) {
        return res.status(404).send('Invalid texture ID');
    }
    
    const texture = worldState.textures.find(t => t.id === id);
    
    if (!texture) {
        return res.status(404).send('Texture not found');
    }
    
    const filename = texture.url.split('/').pop();
    const filepath = `public/textures/${filename}`;
    
    if (fs.existsSync(filepath)) {
        // Disable caching so VRChat re-downloads if we reuse the ID
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Content-Type', 'image/png');
        res.sendFile(filepath, { root: '.' });
    } else {
        res.status(404).send('Texture file not found');
    }
});

// Texture Generation (Used by Phone Website)
app.post('/api/generate', async (req, res) => {
    const { prompt } = req.body;
    
    if (!prompt) {
        return res.status(400).json({ error: "Missing prompt" });
    }
    
    console.log(`[Texture] Generating texture: "${prompt}"`);
    
    try {
        // Generate texture using Gemini
        const texturePrompt = `A seamless tileable texture of: ${prompt}. High quality, suitable for 3D rendering, no text or watermarks.`;
        
        const result = await geminiImageModel.generateContent({
            contents: [{ role: "user", parts: [{ text: texturePrompt }] }],
            generationConfig: {
                responseModalities: ["TEXT", "IMAGE"],
            } as any
        });
        
        // Extract image from response
        const response = result.response;
        let imageData: string | null = null;
        
        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if ((part as any).inlineData) {
                imageData = (part as any).inlineData.data;
                break;
            }
        }
        
        if (!imageData) {
            console.error('[Texture] No image generated');
            return res.status(500).json({ error: "No image generated" });
        }
        
        // Process texture and generate normal/smoothness maps
        const timestamp = Date.now();
        const imageBuffer = Buffer.from(imageData, 'base64');
        const { textureFilename, normalFilename, smoothnessFilename } = 
            await processTextureWithMaps(imageBuffer, timestamp);
        
        const textureUrl = `https://ai.seamen.love/textures/${textureFilename}`;
        const normalUrl = `https://ai.seamen.love/textures/${normalFilename}`;
        const smoothnessUrl = `https://ai.seamen.love/textures/${smoothnessFilename}`;
        
        // Create texture entry with stable ID
        const textureEntry: TextureEntry = {
            id: worldState.nextId++,
            url: textureUrl,
            normalUrl: normalUrl,
            smoothnessUrl: smoothnessUrl
        };
        
        // Recycle IDs 1-20
        if (worldState.nextId > 20) {
            worldState.nextId = 1;
        }
        
        // Add to front of array
        worldState.textures.unshift(textureEntry);
        
        // Keep only the most recent textures
        if (worldState.textures.length > worldState.maxTextures) {
            worldState.textures = worldState.textures.slice(0, worldState.maxTextures);
        }
        
        // Auto-select the new texture
        worldState.selectedId = textureEntry.id;
        
        console.log(`[Texture] Generated ID ${textureEntry.id}: ${textureUrl} (${worldState.textures.length} total)`);
        
        res.json({ 
            success: true, 
            texture: textureEntry,
            textures: worldState.textures,
            selectedId: worldState.selectedId
        });
        
    } catch (error) {
        console.error('[Texture] Generation error:', error);
        res.status(500).json({ error: "Failed to generate texture" });
    }
});

// Generate Normal Map from an image buffer
async function generateNormalMap(inputBuffer: Buffer, outputPath: string): Promise<void> {
    // Get image as raw pixel data
    const image = sharp(inputBuffer);
    const metadata = await image.metadata();
    const width = metadata.width || 512;
    const height = metadata.height || 512;
    
    // Convert to grayscale for height/bump data
    const grayscaleBuffer = await image
        .greyscale()
        .raw()
        .toBuffer();
    
    // Generate normal map using Sobel-like operators
    // We will output 4 channels (RGBA) to match Unity's DXT5nm format expectation
    // Unity UnpackNormal expects: A=X, G=Y, R=1, B=1
    const normalData = Buffer.alloc(width * height * 4);
    const strength = 2.0; // Normal map strength
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            // Sample neighboring pixels (with wrapping for seamless)
            const getPixel = (px: number, py: number) => {
                px = ((px % width) + width) % width;
                py = ((py % height) + height) % height;
                return grayscaleBuffer[py * width + px] / 255.0;
            };
            
            // Sobel operator for gradients
            const left = getPixel(x - 1, y);
            const right = getPixel(x + 1, y);
            const up = getPixel(x, y - 1);
            const down = getPixel(x, y + 1);
            
            // Calculate gradients
            const dx = (left - right) * strength;
            // Unity uses DirectX convention - flip Y compared to OpenGL
            const dy = (down - up) * strength; // Flipped for Unity/DirectX
            const dz = 1.0;
            
            // Normalize
            const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const nx = dx / length;
            const ny = dy / length;
            // nz is not stored in DXT5nm but used for normalization
            
            // Convert to 0-255 range
            // Unity DXT5nm packing:
            // R = 1 (unused/ignored)
            // G = Y (Green channel stores Y component)
            // B = 1 (unused/ignored)
            // A = X (Alpha channel stores X component)
            
            const idx = (y * width + x) * 4;
            normalData[idx + 0] = 255; // R
            normalData[idx + 1] = Math.floor((ny * 0.5 + 0.5) * 255); // G = Y
            normalData[idx + 2] = 255; // B
            normalData[idx + 3] = Math.floor((nx * 0.5 + 0.5) * 255); // A = X
        }
    }
    
    // Save as PNG with Alpha channel
    await sharp(normalData, { raw: { width, height, channels: 4 } })
        .png()
        .toFile(outputPath);
}

// Generate Smoothness Map from an image buffer (inverted roughness based on color variation)
async function generateSmoothnessMap(inputBuffer: Buffer, outputPath: string): Promise<void> {
    const image = sharp(inputBuffer);
    const metadata = await image.metadata();
    const width = metadata.width || 512;
    const height = metadata.height || 512;
    
    // Get grayscale version as base
    const grayscaleBuffer = await image
        .greyscale()
        .raw()
        .toBuffer();
    
    // Calculate local variance to estimate roughness, then invert for smoothness
    const smoothnessData = Buffer.alloc(width * height);
    const windowSize = 3;
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            // Sample window around pixel
            let sum = 0;
            let sumSq = 0;
            let count = 0;
            
            for (let wy = -windowSize; wy <= windowSize; wy++) {
                for (let wx = -windowSize; wx <= windowSize; wx++) {
                    const px = ((x + wx) % width + width) % width;
                    const py = ((y + wy) % height + height) % height;
                    const val = grayscaleBuffer[py * width + px];
                    sum += val;
                    sumSq += val * val;
                    count++;
                }
            }
            
            // Calculate variance (roughness indicator)
            const mean = sum / count;
            const variance = (sumSq / count) - (mean * mean);
            
            // Normalize variance to 0-1, then invert for smoothness
            // High variance = rough surface = low smoothness
            const normalizedVariance = Math.min(variance / 2000, 1.0);
            const smoothness = 1.0 - normalizedVariance;
            
            // Apply some contrast and bias towards mid-range smoothness
            const finalSmoothness = Math.pow(smoothness, 0.7) * 0.8 + 0.1;
            
            smoothnessData[y * width + x] = Math.floor(finalSmoothness * 255);
        }
    }
    
    // Save as grayscale PNG
    await sharp(smoothnessData, { raw: { width, height, channels: 1 } })
        .png()
        .toFile(outputPath);
}

// Process texture and generate all maps
async function processTextureWithMaps(imageBuffer: Buffer, timestamp: number): Promise<{
    textureFilename: string;
    normalFilename: string;
    smoothnessFilename: string;
}> {
    // Ensure directory exists
    if (!fs.existsSync('public/textures')) {
        fs.mkdirSync('public/textures', { recursive: true });
    }
    
    const textureFilename = `texture_${timestamp}.png`;
    const normalFilename = `texture_${timestamp}_normal.png`;
    const smoothnessFilename = `texture_${timestamp}_smoothness.png`;
    
    const texturePath = `public/textures/${textureFilename}`;
    const normalPath = `public/textures/${normalFilename}`;
    const smoothnessPath = `public/textures/${smoothnessFilename}`;
    
    // Save the main texture (convert to PNG to ensure format)
    await sharp(imageBuffer).png().toFile(texturePath);
    
    // Generate normal map
    console.log(`[Texture] Generating normal map...`);
    await generateNormalMap(imageBuffer, normalPath);
    
    // Generate smoothness map
    console.log(`[Texture] Generating smoothness map...`);
    await generateSmoothnessMap(imageBuffer, smoothnessPath);
    
    return { textureFilename, normalFilename, smoothnessFilename };
}

// Upload texture to a specific ID (or create new)
app.post('/api/upload', upload.single('texture'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }
        
        const targetId = req.body.id ? parseInt(req.body.id) : null;
        
        console.log(`[Texture] Uploading texture${targetId ? ` to ID ${targetId}` : ' (new)'}`);
        
        const timestamp = Date.now();
        const { textureFilename, normalFilename, smoothnessFilename } = 
            await processTextureWithMaps(req.file.buffer, timestamp);
        
        const textureUrl = `https://ai.seamen.love/textures/${textureFilename}`;
        const normalUrl = `https://ai.seamen.love/textures/${normalFilename}`;
        const smoothnessUrl = `https://ai.seamen.love/textures/${smoothnessFilename}`;
        
        if (targetId && targetId >= 1 && targetId <= 20) {
            // Update existing texture at this ID or create one with this ID
            const existingIndex = worldState.textures.findIndex(t => t.id === targetId);
            
            const textureEntry: TextureEntry = {
                id: targetId,
                url: textureUrl,
                normalUrl: normalUrl,
                smoothnessUrl: smoothnessUrl
            };
            
            if (existingIndex !== -1) {
                // Replace existing
                worldState.textures[existingIndex] = textureEntry;
                console.log(`[Texture] Replaced texture at ID ${targetId}`);
            } else {
                // Add new with specific ID
                worldState.textures.unshift(textureEntry);
                if (worldState.textures.length > worldState.maxTextures) {
                    worldState.textures = worldState.textures.slice(0, worldState.maxTextures);
                }
                console.log(`[Texture] Created new texture at ID ${targetId}`);
            }
            
            worldState.selectedId = targetId;
            
            res.json({
                success: true,
                texture: textureEntry,
                textures: worldState.textures,
                selectedId: worldState.selectedId
            });
        } else {
            // Create new texture with next ID
            const textureEntry: TextureEntry = {
                id: worldState.nextId++,
                url: textureUrl,
                normalUrl: normalUrl,
                smoothnessUrl: smoothnessUrl
            };
            
            if (worldState.nextId > 20) {
                worldState.nextId = 1;
            }
            
            worldState.textures.unshift(textureEntry);
            if (worldState.textures.length > worldState.maxTextures) {
                worldState.textures = worldState.textures.slice(0, worldState.maxTextures);
            }
            
            worldState.selectedId = textureEntry.id;
            
            console.log(`[Texture] Uploaded new texture ID ${textureEntry.id}`);
            
            res.json({
                success: true,
                texture: textureEntry,
                textures: worldState.textures,
                selectedId: worldState.selectedId
            });
        }
    } catch (error) {
        console.error('[Texture] Upload error:', error);
        res.status(500).json({ error: "Failed to upload texture" });
    }
});

app.get('/toggles', (_, res) => {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="a.csv"`);
    res.send(isNight);
});

app.get('/current-prompts', (_, res) => {
    res.json({
        darePrompt: currentDarePrompt,
        truthPrompt: currentTruthPrompt,
        drinkPrompt: currentDrinkPrompt,
        tablePrompt: currentTablePrompt,
        promptAmount: promptAmount
    });
});

app.get('/spinthebottle', (_, res) => {
    loadAndReturnFile("spinthebottle", res);
});

app.get('/spinthetable', (_, res) => {
    loadAndReturnFile("spinthetable", res);
});

async function loadAndReturnFile(filename: string, res: any) {
    fs.readFile(filename + '.csv', 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading CSV file:', err);
            res.status(500).send('Error reading CSV file');
            return;
        }
        console.log('CSV Contents:', data);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
        res.send(data);
    });
}

app.post("/updateandrestart", () => {
    var spawn = require('child_process').spawn;
    spawn('sh', ['../update-node.sh'], {
        detached: true
    });
    setTimeout(function() {
        process.exit(0);
    }, 5000);
});

app.post('/settoggles', async (req, res) => {
    console.log("setToggles");
    console.log(JSON.stringify(req.body));
    var ta = req.body.toggleA;
    console.log(ta);
    isNight = ta;

    res.json({res: "It good"});
});

app.post('/regenerate', async (req, res) => {
    console.log("Prompt initial: " + req.body.promptAmount.toString());
    promptAmount = parseInt(req.body.promptAmount.toString()) ?? 10;
    if (promptAmount > 30) {
        promptAmount = 30;
    }
    if (Number.isNaN(promptAmount)) {
        promptAmount = 10;
    }

    console.log("Prompt amount: " + promptAmount);

    currentDarePrompt = `${req.body.darePrompt || ''}`.trim();
    currentTruthPrompt = `${req.body.truthPrompt || ''}`.trim();
    currentDrinkPrompt = `${req.body.drinkPrompt || ''}`.trim();
    currentTablePrompt = `${req.body.tablePrompt || ''}`.trim();
    let a = `${req.body.aiModel}`.trim();
    if (a != "") {
        openRouterModel = a;
    }
    else
    {
        openRouterModel = 'x-ai/grok-4.1-fast';
    }

    let res2 = await regeneratePrompts();

    res.json({prompts: res2});
});

// Generate prompts and save to CSV on server start
(async () => {
    let f = fs.existsSync("spinthebottle.csv");
    console.log("Has previous prompt file: " + f);
    if (!f) {
        let a = await regeneratePrompts();
        console.log('Initial prompts generated and saved to csv' + a);
    }
})();

async function regeneratePrompts() {
    let dareP = `${fixedPromptParts.dare} ${currentDarePrompt}`.trim();
    let truthP = `${fixedPromptParts.truth} ${currentTruthPrompt}`.trim();
    let drinkP = `${fixedPromptParts.drink} ${currentDrinkPrompt}`.trim();
    let aiModel = `${fixedPromptParts.drink} ${currentDrinkPrompt}`.trim();
    //let tableP = `${fixedPromptParts.table} ${currentTablePrompt}`.trim();
    console.log("Generating drinking prompts");
    let a = await generateAndSavePrompts([dareP, truthP, drinkP], "spinthebottle", promptAmount);
    //console.log("Generating table prompts");
    //let b = await generateAndSavePrompts([tableP], "spinthetable", promptAmount);

    //return a + "," + b;
    return a;
}

// Create HTTPS server
const httpsServer = https.createServer(options, app);
httpsServer.listen(443, () => {
    console.log('HTTPS Server running on port 443');
}).on('error', (err) => {
    console.error('Failed to start HTTPS server:', err);
});

// Create HTTP server using the Express app
const httpServer = http.createServer(app);
httpServer.listen(80, () => {
    console.log('HTTP Server running on port 80');
}).on('error', (err) => {
    console.error('Failed to start HTTP server:', err);
});

// Add a catch-all route to redirect HTTP to HTTPS (except for ACME challenges)
app.use((req, res, next) => {
    if (!req.secure && !req.url.startsWith('/.well-known/acme-challenge/')) {
        return res.redirect(`https://${req.headers.host}${req.url}`);
    }
    next();
});