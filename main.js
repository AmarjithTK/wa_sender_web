const { Client, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode');
const qrcodeterminal = require("qrcode-terminal")

const app = express();
const port = 4000;

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// Setup static folder and view engine
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');

// Initialize WhatsApp client
const client = new Client({
    puppeteer: {
        headless: true,
        args: ['--no-sandbox']
    }
});

let isClientReady = false;

// HTML Templates

// Initialize WebSocket server
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 5000 });

let wsConnections = new Set();

wss.on('connection', (ws) => {
    console.log('recevied q1')

    wsConnections.add(ws);
    ws.on('close', () => {
        wsConnections.delete(ws);
    });
});

// WhatsApp client events
client.on('qr', async (qr) => {
    console.log('recevied qr')
    console.log(qr)
    qrcodeterminal.generate(qr, { small: true });

    const qrImage = await qrcode.toDataURL(qr);
    wsConnections.forEach(ws => {
        ws.send(JSON.stringify({ type: 'qr', qr: qrImage }));
    });
});

client.on('ready', () => {
    isClientReady = true;
    wsConnections.forEach(ws => {
        ws.send(JSON.stringify({ type: 'status', message: 'WhatsApp client is ready!' }));
    });
});

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.post('/send', upload.fields([
    { name: 'excel', maxCount: 1 },
    { name: 'attachments', maxCount: 10 }
]), async (req, res) => {
    if (!isClientReady) {
        return res.status(400).json({ error: 'WhatsApp client not ready' });
    }

    try {
        // Read Excel file
        const workbook = xlsx.readFile(req.files.excel[0].path);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const phones = xlsx.utils.sheet_to_json(sheet).map(row => row.Phone?.toString());

        const messages = Array.isArray(req.body.messages) ? req.body.messages : [req.body.messages];
        const interval = parseInt(req.body.interval) * 1000 || 10000;

        const results = [];

        // Process each phone number
        for (const phone of phones) {
            try {
                const formattedPhone = phone.replace(/\D/g, '');

                // Send messages
                for (const message of messages) {
                    if (message.trim()) {
                        await client.sendMessage(`${formattedPhone}@c.us`, message);
                    }
                }

                // Send attachments if any
                if (req.files.attachments) {
                    for (const file of req.files.attachments) {
                        const media = MessageMedia.fromFilePath(file.path);
                        await client.sendMessage(`${formattedPhone}@c.us`, media);
                    }
                }

                results.push({ phone, status: 'success' });
                await new Promise(resolve => setTimeout(resolve, interval));

            } catch (error) {
                results.push({ phone, status: 'failed', error: error.message });
            }
        }

        // Cleanup uploaded files
        if (req.files.excel) {
            fs.unlinkSync(req.files.excel[0].path);
        }
        if (req.files.attachments) {
            req.files.attachments.forEach(file => fs.unlinkSync(file.path));
        }

        res.json({ success: true, results });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    client.initialize();
});
