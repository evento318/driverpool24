import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Bind to 0.0.0.0 so the server is reachable from localhost/WSL/VM
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Driverpool24 läuft auf Port ${PORT}`);
});
