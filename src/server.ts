import * as express from 'express';
import * as bodyParser from 'body-parser';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import { OpenAI } from "openai";
require('dotenv').config();

const app = express();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
  dare: 'Generate a dare prompt for a game of spin the bottle.',
  truth: 'Generate a truth prompt for a game of spin the bottle.',
  drink: 'Generate a drink prompt for a game of spin the bottle.',
  table: 'Generate a drink prompt for a game of spin the bottle.'
};

let currentDarePrompt = '';
let currentTruthPrompt = '';
let currentDrinkPrompt = '';
let currentTablePrompt = '';
let promptAmount = 10;

async function generatePrompt(prompt: string): Promise<string> {
  try {
    const completion = await openai.chat.completions.create({
      messages: [
        { role: 'system', content: 'You are the one with the best drinking games, keep it less than 12 words, keep in mind this will be performed in a VR game called VRCHAT, and also, like dont be cringe dude.' },
        { role: 'user', content: prompt },
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
  let res: string[] = [];
  for (let j = 0; j < prompts.length; j++) {
    for (let i = 0; i < amount; i++) {
      res.push(await generatePrompt(prompts[j]));
    }
  }
  return res;
}

async function saveCsv(filename: string, data: string) {
  fs.writeFileSync(filename + '.csv', data, 'utf8')
  console.log('CSV file saved successfully');
}

async function generateAndSavePrompts(prompts: string[], filename: string, amount: number) {
  let res = (await generatePrompts(prompts, amount)).join(',');
  saveCsv(filename, res);
  return res;
}

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

  var res2 = await regeneratePrompts();

  res.json({ prompts: res2 });
});

// Generate prompts and save to CSV on server start
(async () => {
  let a = await regeneratePrompts();
  console.log('Initial prompts generated and saved to csv' + a);
})();

async function regeneratePrompts() {
  let dareP = `${fixedPromptParts.dare} ${currentDarePrompt}`.trim();
  let truthP = `${fixedPromptParts.truth} ${currentTruthPrompt}`.trim();
  let drinkP = `${fixedPromptParts.drink} ${currentDrinkPrompt}`.trim();
  let tableP = `${fixedPromptParts.table} ${currentTablePrompt}`.trim();
  console.log("Generating drinking prompts");
  let a = await generateAndSavePrompts([dareP, truthP, drinkP], "spinthebottle", promptAmount);
  console.log("Generating table prompts");
  let b = await generateAndSavePrompts([tableP], "spinthetable", promptAmount);

  return a + "," + b;
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
