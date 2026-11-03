# NotteRicerca2025 — Climate Change and Food Production

## Overview

**NotteRicerca2025** is a multiplayer educational web application designed to explore the relationship between climate change and food production through an interactive game based on FAOSTAT data.

Players compete by selecting countries and comparing their food export values, while a game manager controls the session and monitors the results. The project aims to make global food production and trade data more accessible through a collaborative and engaging experience.

## Features

- **Multiplayer gameplay:** players can join game rooms using a room code.
- **Game management:** the manager creates game sessions, selects the product and configures the number of countries each player must choose.
- **Interactive country selection:** players select countries using an autocomplete interface.
- **Score calculation:** scores are calculated from the selected countries' data.
- **Leaderboard:** players' results are ranked to determine the winner.
- **Data visualization:** the manager can view a chart highlighting the leading countries for the selected product.

## Technologies

- **Node.js** — server-side JavaScript runtime
- **Express.js** — web server
- **Socket.IO** — real-time communication between the server and clients
- **HTML and CSS** — user interface
- **Chart.js** — data visualization
- **FAOSTAT** — food and agricultural statistics dataset

## Architecture

The application follows a client-server architecture. The server manages game rooms, player connections, game settings and score calculations, while Socket.IO enables real-time communication between the manager and players.

The application uses FAOSTAT data to support the game's comparisons and visualizations.

## Getting Started

### Prerequisites

- Node.js and npm
- The FAOSTAT dataset used by the application

### Installation

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd <repository-folder>
   ```

2. Install the dependencies:

   ```bash
   npm install
   ```

3. Ensure that the dataset is available in the location expected by the server. The application uses `FAOSTAT_data_it.csv`.

4. Start the server using the configured npm script:

   ```bash
   npm start
   ```

5. Open `http://localhost:3000` in your browser, provided that the server is configured to use port 3000 locally.

## Project Context

Developed as part of **NotteRicerca2025**, this project combines data exploration, web development and multiplayer interaction to communicate topics related to food production and global agricultural trade.

