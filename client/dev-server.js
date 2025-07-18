const express = require('express');
const path = require('path');

const app = express();
const PORT = 8080;

// Serve static files from client directory
app.use(express.static(__dirname));

// Catch all routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Client dev server running on http://localhost:${PORT}`);
});