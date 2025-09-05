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
// Lettura CSV
// ======================
const productsData = [];
let csvLoaded = false;

const csvPath = path.join(__dirname, "FAOSTAT_data_it.csv");

fs.createReadStream(csvPath)
  .pipe(csv({ separator: "," }))
  .on("data", (row) => {
    // Salva solo righe valide
    if (row["Item"] && row["Area"] && row["Year"] && row["Value"]) {
      productsData.push({
        Product: row["Item"],
        Country: row["Area"],
        Year: parseInt(row["Year"]),
        Value: parseFloat(row["Value"]) || 0
      });
    }
  })
  .on("end", () => {
    csvLoaded = true;
    console.log("✅ CSV caricato, righe:", productsData.length);
  })
  .on("error", (err) => {
    console.error("Errore apertura CSV:", err);
  });

// ======================
// Endpoint API (opzionale)
// ======================
app.get("/api/products", (req, res) => {
  const products = [...new Set(productsData.map(p => p.Product))];
  res.json(products);
});

app.get("/api/countries", (req, res) => {
  const countries = [...new Set(productsData.map(p => p.Country))];
  res.json(countries);
});

app.get("/api/years", (req, res) => {
  const years = [...new Set(productsData.map(p => p.Year))];
  res.json(years);
});

// ======================
// Gestione stanze
// ======================
const rooms = {};

io.on("connection", (socket) => {
  console.log("Nuovo client connesso:", socket.id);

  // Creazione stanza
  socket.on("createRoom", () => {
    if (!csvLoaded) {
      socket.emit("errorMsg", "⚠️ Dati non ancora pronti. Attendi qualche secondo.");
      return;
    }

    const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    rooms[roomId] = { manager: socket.id, players: [], settings: null, started: false };
    socket.join(roomId);

    const products = [...new Set(productsData.map(p => p.Product))].filter(Boolean);

    socket.emit("roomCreated", { roomId, products });
  });

  // Join stanza
  socket.on("joinRoom", ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit("errorMsg", "Stanza non trovata");
      return;
    }
    const player = { id: socket.id, name, countries: [], score: 0 };
    room.players.push(player);
    socket.join(roomId);
    io.to(roomId).emit("playerList", room.players);
  });

  // Imposta settaggi
  socket.on("setSettings", ({ roomId, product, numCountries }) => {
    const room = rooms[roomId];
    if (!room) return;
    room.settings = { product, year: 2023, numCountries };

    // Lista dei Paesi disponibili per il prodotto
    const availableCountries = [
      ...new Set(productsData.filter(p => p.Product === product && p.Year === 2023).map(p => p.Country))
    ];
    room.availableCountries = availableCountries;

    io.to(roomId).emit("settingsUpdated", room.settings);
    io.to(roomId).emit("countriesList", availableCountries);
  });

  // Avvio partita
  socket.on("startGame", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.settings) return;
    room.started = true;
    io.to(roomId).emit("gameStarted", room.settings);
  });

  // Scelta Paesi da parte dei giocatori
  socket.on("selectCountry", ({ roomId, country }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || !room.settings) return;

    // Limita al numero di Paesi scelto dal manager
    if (player.countries.length < room.settings.numCountries && !player.countries.includes(country)) {
      player.countries.push(country);
    }
    io.to(roomId).emit("playerList", room.players);
  });

  // Fine partita
  socket.on("endGame", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.settings) return;
  
    const { product, year } = room.settings;
  
    // 🔹 Debug (facoltativo)
    console.log("Prodotto selezionato dal manager:", product);
    console.log("Prodotti disponibili nel CSV:", [...new Set(productsData.map(p => p.Product))]);
  
    // Filtra i dati del CSV per prodotto + anno (case insensitive e trim)
    const filtered = productsData.filter(
      (row) =>
        row.Product.trim().toLowerCase() === product.trim().toLowerCase() &&
        row.Year === 2023 // anno fisso
    );
  
    if (!filtered.length) {
      socket.emit("errorMsg", "Nessun dato trovato per questo prodotto/anno!");
      return;
    }
  
    // Totale mondiale
    const totalWorld = filtered.reduce((acc, r) => acc + r.Value, 0);
  
    // Punteggi giocatori
    room.players.forEach((player) => {
      let total = 0;
      player.countries.forEach((country) => {
        const match = filtered.find(
          (row) => row.Country.trim().toLowerCase() === country.trim().toLowerCase()
        );
        if (match) total += match.Value;
      });
      player.score = total;
      player.percentage = totalWorld > 0 ? (total / totalWorld) * 100 : 0;
    });
  
    const leaderboard = [...room.players].sort((a, b) => b.score - a.score);
  
    // Top Paesi per grafico
    const topCountries = filtered
      .sort((a, b) => b.Value - a.Value)
      .slice(0, 5)
      .map((row) => ({
        Country: row.Country.trim(),
        Value: Number(row.Value) || 0,
        Percent: totalWorld > 0 ? (Number(row.Value) / totalWorld) * 100 : 0,
      }));

    // Invia i risultati al client
    io.to(roomId).emit("gameEnded", {
      leaderboard,
      topCountries,
      totalWorld,
    });
  });

  // Disconnessione
  socket.on("disconnect", () => {
    console.log("Client disconnesso:", socket.id);
    for (const roomId in rooms) {
      const room = rooms[roomId];
      room.players = room.players.filter(p => p.id !== socket.id);
      io.to(roomId).emit("playerList", room.players);
    }
  });
});

// ======================
// Avvio server
// ======================
server.listen(PORT, () => {
  console.log(`Server attivo su http://localhost:${PORT}`);
});
