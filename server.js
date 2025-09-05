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

app.use(express.static(path.join(__dirname, "public")));

const productsData = [];
let csvLoaded = false;

const csvPath = path.join(__dirname, "FAOSTAT_data_it.csv");

fs.createReadStream(csvPath)
  .pipe(csv({ separator: "," }))
  .on("data", (row) => {
    if (row["Item"] && row["Area"] && row["Year"] && row["Value"]) {
      productsData.push({
        Product: row["Item"],
        Country: row["Area"],
        Year: parseInt(row["Year"]),
        Value: parseFloat(row["Value"]) || 0,
      });
    }
  })
  .on("end", () => {
    csvLoaded = true;
    console.log("✅ CSV caricato, righe:", productsData.length);
  });

const rooms = {};

io.on("connection", (socket) => {
  console.log("Nuovo client:", socket.id);

  // Creazione stanza
  socket.on("createRoom", () => {
    if (!csvLoaded) return socket.emit("errorMsg", "CSV non ancora pronto");
    const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    rooms[roomId] = { manager: socket.id, players: [], settings: null };
    socket.join(roomId);
    socket.emit("roomCreated", { roomId });
  });

  // Imposta settaggi
  socket.on("setSettings", ({ roomId, product, year, numCountries }) => {
    const room = rooms[roomId];
    if (!room) return;
    room.settings = { product, year, numCountries };
    // Lista dei Paesi disponibili
    const availableCountries = [
      ...new Set(
        productsData
          .filter((p) => p.Product === product && p.Year === year)
          .map((p) => p.Country)
      ),
    ];
    room.availableCountries = availableCountries;

    io.to(roomId).emit("settingsUpdated", room.settings);
    io.to(roomId).emit("countriesList", availableCountries);
  });

  // Player entra
  socket.on("joinRoom", ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit("errorMsg", "Stanza non trovata");
    const player = { id: socket.id, name, countries: [], score: 0 };
    room.players.push(player);
    socket.join(roomId);

    io.to(roomId).emit("playerList", room.players);

    if (room.settings) {
      socket.emit("settingsUpdated", room.settings);
      socket.emit("countriesList", room.availableCountries);
    }
  });

  // Player invia scelte
  socket.on("selectCountry", ({ roomId, country }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player || !room.settings) return;

    if (!player.countries.includes(country)) {
      player.countries.push(country);
    }

    // Invia aggiornamento in tempo reale al manager
    io.to(roomId).emit("playerList", room.players);
  });

  // Manager termina gioco
  socket.on("endGame", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !room.settings) return;

    const { product, year } = room.settings;
    const filtered = productsData.filter(
      (row) =>
        row.Product.trim().toLowerCase() === product.trim().toLowerCase() &&
        row.Year === year
    );

    const totalWorld = filtered.reduce((acc, r) => acc + r.Value, 0);

    room.players.forEach((player) => {
      let total = 0;
      player.countries.forEach((country) => {
        const match = filtered.find(
          (row) => row.Country.trim().toLowerCase() === country.trim().toLowerCase()
        );
        if (match) total += match.Value;
      });
      player.score = total;
      player.percentage = totalWorld ? (total / totalWorld) * 100 : 0;
    });

    const leaderboard = [...room.players].sort((a, b) => b.score - a.score);
    const topCountries = filtered
      .sort((a, b) => b.Value - a.Value)
      .slice(0, 5)
      .map((r) => ({
        Country: r.Country,
        Value: r.Value,
        Percent: totalWorld ? (r.Value / totalWorld) * 100 : 0,
      }));

    io.to(roomId).emit("gameEnded", { leaderboard, topCountries, totalWorld });
  });

  socket.on("disconnect", () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      room.players = room.players.filter((p) => p.id !== socket.id);
      io.to(roomId).emit("playerList", room.players);
    }
  });
});

server.listen(PORT, () => console.log(`Server attivo su http://localhost:${PORT}`));
