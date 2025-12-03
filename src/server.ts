import express from 'express';
import * as bodyParser from 'body-parser';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import {OpenAI} from "openai";
import {GoogleGenerativeAI} from "@google/generative-ai";
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { streamText, ModelMessage } from 'ai';

require('dotenv').config({ override: true });

const app = express();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
});

let openRouterModel = openrouter('x-ai/grok-4.1-fast:free');

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const geminiModel = genAI.getGenerativeModel({model: "gemini-2.5-flash"});
const geminiImageModel = genAI.getGenerativeModel({model: "gemini-2.0-flash-exp"});

// VRChat Dynamic Texture System
interface WorldState {
    textures: string[];  // Array of texture URLs (most recent first)
    selectedIndex: number;  // Which texture is selected for applying
    maxTextures: number;
}

const worldState: WorldState = {
    textures: [],
    selectedIndex: 0,
    maxTextures: 10
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

const originPrompt: string = "You are a spin the bottle prompt generator, no singing, keep it in mind that the person that was randomly selected is the one doing the action, keep it less than 12 words, keep in mind this will be in a VR game called VRCHAT, and also, like dont be cringe dude. Only generate 1 option per message. Don't mention spin the bottle.";

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
            let messages : ModelMessage[] = [{
                role: 'system',
                content: originPrompt,
            }];

            messages = await sendOpenRouterMessage(messages);

            for (let j = 0; j < amount; j++) {
                messages.push({
                    role: 'user',
                    content: prompts[j]
                });

                console.log("Sending message: " + prompts[j]);

                messages = await sendOpenRouterMessage(messages);
            }

            messages.filter((m) => m.role != 'user' && m.role != 'system').forEach((m) => res.push(m.content as string));
        }

        return res;
    }
    catch (error) {
        console.error('Error generating prompt:', error);
        return [];
    }
}

async function sendOpenRouterMessage(chat: ModelMessage[] = []): Promise<ModelMessage[]> {
    const text = await (streamText({
        model: openRouterModel,
        messages: chat
    })).text;

    chat.push({role: 'assistant', content: text});
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
        selectedIndex: worldState.selectedIndex
    });
});

// Select which texture to apply (Used by Phone Website)
app.post('/api/select_texture', (req, res) => {
    const { index } = req.body;
    
    if (typeof index !== 'number' || index < 0 || index >= worldState.textures.length) {
        return res.status(400).json({ error: "Invalid texture index" });
    }
    
    worldState.selectedIndex = index;
    console.log(`[Texture] Selected texture index: ${index}`);
    
    res.json({ success: true, selectedIndex: index });
});

// Serve current selected texture at fixed URL (Used by VRChat)
app.get('/textures/current.png', (req, res) => {
    const currentTexture = worldState.textures[worldState.selectedIndex];
    
    if (!currentTexture) {
        return res.status(404).send('No texture selected');
    }
    
    // Extract filename from URL and serve the file
    const filename = currentTexture.split('/').pop();
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
    
    // Return current selected texture URL for VRChat to download
    const currentTexture = worldState.textures[worldState.selectedIndex] || "";
    res.json({
        textureUrl: currentTexture,
        selectedIndex: worldState.selectedIndex,
        textureCount: worldState.textures.length
    });
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
        
        // Ensure directory exists
        if (!fs.existsSync('public/textures')) {
            fs.mkdirSync('public/textures', { recursive: true });
        }
        
        // Save with timestamp filename
        const timestamp = Date.now();
        const filename = `texture_${timestamp}.png`;
        const filepath = `public/textures/${filename}`;
        fs.writeFileSync(filepath, Buffer.from(imageData, 'base64'));
        
        const textureUrl = `https://ai.seamen.love/textures/${filename}`;
        
        // Add to front of array
        worldState.textures.unshift(textureUrl);
        
        // Keep only the most recent textures
        if (worldState.textures.length > worldState.maxTextures) {
            worldState.textures = worldState.textures.slice(0, worldState.maxTextures);
        }
        
        // Auto-select the new texture
        worldState.selectedIndex = 0;
        
        console.log(`[Texture] Generated: ${textureUrl} (${worldState.textures.length} total)`);
        
        res.json({ 
            success: true, 
            textureUrl: textureUrl,
            textures: worldState.textures,
            selectedIndex: worldState.selectedIndex
        });
        
    } catch (error) {
        console.error('[Texture] Generation error:', error);
        res.status(500).json({ error: "Failed to generate texture" });
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
        openRouterModel = openrouter(a);
    }
    else
    {
        openRouterModel = openrouter('x-ai/grok-4.1-fast:free');
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