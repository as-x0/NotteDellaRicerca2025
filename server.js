import express from "express";
import http from "http";
import { Server } from "socket.io";
import fs from "fs";
import csv from "csv-parser";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Servire file statici
app.use(express.static(path.join(__dirname, "public")));

// ======================
// Funzione per rilevare separatore
// ======================
function detectSeparator(csvPath) {
  const firstLine = fs.readFileSync(csvPath, "utf-8").split("\n")[0];
  const counts = {
    comma: (firstLine.match(/,/g) || []).length,
    semicolon: (firstLine.match(/;/g) || []).length,
    tab: (firstLine.match(/\t/g) || []).length,
  };

  // Scegli il separatore più frequente
  let sep = ",";
  if (counts.tab >= counts.comma && counts.tab >= counts.semicolon) sep = "\t";
  else if (counts.semicolon >= counts.comma && counts.semicolon >= counts.tab) sep = ";";
  return sep;
}

// ======================
// Lettura CSV "bulletproof" con separatore automatico
// ======================
const productsData = [];
let csvLoaded = false;

const csvPath = path.join(__dirname, "FAOSTAT_data_it.csv");
const separator = detectSeparator(csvPath);
console.log("Separatore rilevato:", separator === "\t" ? "TAB" : separator);

fs.createReadStream(csvPath)
  .pipe(csv({ separator }))
  .on("data", (row) => {
    const item = row["Item"]?.replace(/^\uFEFF/, "").trim();
    const area = row["Area"]?.trim();
    const year = parseInt(row["Year"]);
    const value = parseFloat(row["Value"]);

    if (item && area && !isNaN(year) && !isNaN(value)) {
      productsData.push({
        Product: item,
        ProductLower: item.toLowerCase(),
        Country: area,
        CountryLower: area.toLowerCase(),
        Year: year,
        Value: value
      });
    }
  })
  .on("end", () => {
    csvLoaded = true;
    console.log("✅ CSV caricato, righe:", productsData.length);
    console.log("Prime 5 righe:", productsData.slice(0,5));
  })
  .on("error", (err) => console.error("Errore apertura CSV:", err));

// ======================
// Gestione stanze
// ======================
const rooms = {};

io.on("connection", (socket) => {
  console.log("Nuovo client connesso:", socket.id);

  socket.on("getProducts", () => {
    if (!csvLoaded) return socket.emit("errorMsg", "CSV non pronto, attendi...");
    const products = [...new Set(productsData.map(p => p.Product))].filter(Boolean);
    socket.emit("productsList", products);
  });

  socket.on("createRoom", ({ product, numCountries }) => {
    if (!csvLoaded) return socket.emit("errorMsg", "CSV non pronto, attendi...");
    const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    const roomSettings = { product, numCountries, year: 2023 };

    const availableCountries = [
      ...new Set(
        productsData
          .filter(p => p.ProductLower === product.trim().toLowerCase() && p.Year === 2023)
          .map(p => p.Country)
      )
    ];

    rooms[roomId] = {
      manager: socket.id,
      players: [],
      settings: roomSettings,
      availableCountries,
      started: false
    };

    socket.join(roomId);
    socket.emit("roomCreated", { roomId, settings: roomSettings, availableCountries });
    console.log(`Stanza ${roomId} creata per prodotto: ${product}`);
  });

  socket.on("joinRoom", ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit("errorMsg", "Stanza non trovata");
    const player = { id: socket.id, name, countries: [], score: 0 };
    room.players.push(player);
    socket.join(roomId);

    socket.emit("settingsUpdated", room.settings);
    socket.emit("countriesList", room.availableCountries);

    io.to(roomId).emit("playerList", room.players);
  });

  socket.on("startGame", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.settings) return;
    room.started = true;
    io.to(roomId).emit("gameStarted", room.settings);
  });

  socket.on("selectCountry", ({ roomId, country }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || !room.settings) return;

    if (player.countries.length < room.settings.numCountries && !player.countries.includes(country)) {
      player.countries.push(country);
    }
    io.to(roomId).emit("playerList", room.players);
  });

  socket.on("endGame", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.settings) return;

    const { product, year } = room.settings;

    const filtered = productsData.filter(
      p => p.ProductLower === product.trim().toLowerCase() && p.Year === year
    );

    if (!filtered.length) return socket.emit("errorMsg", "Nessun dato trovato per questo prodotto/anno!");

    const totalWorld = filtered.reduce((acc, r) => acc + r.Value, 0);

    room.players.forEach(player => {
      let total = 0;
      player.countries.forEach(country => {
        const match = filtered.find(r => r.CountryLower === country.trim().toLowerCase());
        if (match) total += match.Value;
      });
      player.score = total;
      player.percentage = totalWorld > 0 ? (total / totalWorld) * 100 : 0;
    });

    const leaderboard = [...room.players].sort((a,b)=>b.score - a.score);

    const topCountries = filtered
      .sort((a,b)=>b.Value - a.Value)
      .slice(0,5)
      .map(r => ({
        Country: r.Country,
        Value: r.Value,
        Percent: totalWorld > 0 ? (r.Value / totalWorld) * 100 : 0
      }));

    io.to(roomId).emit("gameEnded", { leaderboard, topCountries, totalWorld });
  });

  socket.on("disconnect", () => {
    console.log("Client disconnesso:", socket.id);
    for (const roomId in rooms) {
      const room = rooms[roomId];
      room.players = room.players.filter(p => p.id !== socket.id);
      io.to(roomId).emit("playerList", room.players);
    }
  });
});

server.listen(PORT, () => console.log(`Server attivo su http://localhost:${PORT}`));
