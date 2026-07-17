const supabaseclient_URL = "https://vhnyhyuwxrilkczbnveu.supabase.co";
const supabaseclient_ANON_KEY = "sb_publishable_W53L_isSWti1jid7w6Owcg_16vjhi93";

const supabaseclient = window.supabase.createClient(supabaseclient_URL, supabaseclient_ANON_KEY);

let lobbyCode = null;
let myPlayerId = null;
let isHost = false;
let lobbySettings = { numMurderers: 1, numSheriffs: 0 };
let roleRevealed = false;
let myRole = null;

function showScreen(id) {
  document.querySelectorAll(".container").forEach(el => el.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

/* ---------------------- HOST FLOW ---------------------- */

async function createLobby() {
  const errorEl = document.getElementById("createError");
  errorEl.textContent = "";

  const name = document.getElementById("hostName").value.trim();
  const numMurderers = parseInt(document.getElementById("numMurderers").value);
  const numSheriffs = parseInt(document.getElementById("numSheriffs").value);

  if (!name) { errorEl.textContent = "Vul je naam in."; return; }
  if (isNaN(numMurderers) || numMurderers < 1 || isNaN(numSheriffs) || numSheriffs < 0) {
    errorEl.textContent = "Controleer het aantal moordenaars/sheriffs.";
    return;
  }

  isHost = true;
  lobbySettings = { numMurderers, numSheriffs };

  let code = generateCode();
  let { error: lobbyErr } = await supabaseclient.from("lobbies").insert({
    code,
    num_murderers: numMurderers,
    num_sheriffs: numSheriffs,
    started: false
  });

  if (lobbyErr) {
    errorEl.textContent = "Kon lobby niet aanmaken: " + lobbyErr.message;
    return;
  }

  lobbyCode = code;

  const { data: playerRow, error: playerErr } = await supabaseclient
    .from("players")
    .insert({ lobby_code: lobbyCode, name })
    .select()
    .single();

  if (playerErr) {
    errorEl.textContent = "Kon je niet toevoegen als speler: " + playerErr.message;
    return;
  }

  myPlayerId = playerRow.id;

  document.getElementById("lobbyCodeDisplay").textContent = lobbyCode;
  updateHostRequirement();
  showScreen("host-lobby");
  subscribeToPlayers();
  refreshHostPlayerList();
}

function updateHostRequirement() {
  const needed = lobbySettings.numMurderers + lobbySettings.numSheriffs;
  document.getElementById("hostRequirement").textContent =
    `Minimaal ${needed} speler(s) nodig om te starten.`;
}

async function refreshHostPlayerList() {
  const { data: players, error } = await supabaseclient
    .from("players")
    .select("id, name")
    .eq("lobby_code", lobbyCode)
    .order("joined_at", { ascending: true });

  if (error) return;

  const list = document.getElementById("hostPlayerList");
  list.innerHTML = "";
  players.forEach(p => {
    const li = document.createElement("li");
    li.textContent = p.name + (p.id === myPlayerId ? " (jij, host)" : "");
    list.appendChild(li);
  });

  const needed = lobbySettings.numMurderers + lobbySettings.numSheriffs;
  document.getElementById("startRoundBtn").disabled = players.length < needed;
}

async function startRound() {
  const errorEl = document.getElementById("hostError");
  errorEl.textContent = "";

  const { data: players, error } = await supabaseclient
    .from("players")
    .select("id")
    .eq("lobby_code", lobbyCode);

  if (error) { errorEl.textContent = "Fout bij ophalen spelers."; return; }

  const needed = lobbySettings.numMurderers + lobbySettings.numSheriffs;
  if (players.length < needed) {
    errorEl.textContent = "Niet genoeg spelers.";
    return;
  }

  const ids = players.map(p => p.id);
  shuffle(ids);

  const roles = new Array(ids.length).fill("Burger");
  for (let i = 0; i < lobbySettings.numMurderers; i++) roles[i] = "Moordenaar";
  for (let i = lobbySettings.numMurderers; i < lobbySettings.numMurderers + lobbySettings.numSheriffs; i++) roles[i] = "Sheriff";

  for (let i = 0; i < ids.length; i++) {
    const { error: updErr } = await supabaseclient
      .from("players")
      .update({ role: roles[i] })
      .eq("id", ids[i]);
    if (updErr) { errorEl.textContent = "Fout bij toewijzen rollen: " + updErr.message; return; }
  }

  await supabaseclient.from("lobbies").update({ started: true }).eq("code", lobbyCode);

  // Host also views their own role now
  showScreen("player-view");
  document.getElementById("waitingNote").classList.add("hidden");
  document.getElementById("roleBox").classList.remove("hidden");
  subscribeToOwnRole();
}

/* ---------------------- JOIN FLOW ---------------------- */

async function joinLobby() {
  const errorEl = document.getElementById("joinError");
  errorEl.textContent = "";

  const code = document.getElementById("joinCode").value.trim().toUpperCase();
  const name = document.getElementById("joinName").value.trim();

  if (!code || !name) { errorEl.textContent = "Vul code en naam in."; return; }

  const { data: lobby, error: lobbyErr } = await supabaseclient
    .from("lobbies")
    .select("*")
    .eq("code", code)
    .single();

  if (lobbyErr || !lobby) { errorEl.textContent = "Lobby niet gevonden."; return; }
  if (lobby.started) { errorEl.textContent = "Deze ronde is al gestart."; return; }

  const { data: playerRow, error: playerErr } = await supabaseclient
    .from("players")
    .insert({ lobby_code: code, name })
    .select()
    .single();

  if (playerErr) { errorEl.textContent = "Kon niet joinen: " + playerErr.message; return; }

  lobbyCode = code;
  myPlayerId = playerRow.id;
  isHost = false;

  showScreen("player-view");
  subscribeToPlayers(true);
  subscribeToOwnRole();
  refreshPlayerPlayerList();
}

async function refreshPlayerPlayerList() {
  const { data: players, error } = await supabaseclient
    .from("players")
    .select("id, name")
    .eq("lobby_code", lobbyCode)
    .order("joined_at", { ascending: true });

  if (error) return;

  const list = document.getElementById("playerPlayerList");
  list.innerHTML = "";
  players.forEach(p => {
    const li = document.createElement("li");
    li.textContent = p.name + (p.id === myPlayerId ? " (jij)" : "");
    list.appendChild(li);
  });
}

/* ---------------------- REALTIME ---------------------- */

function subscribeToPlayers(isJoiner) {
  supabaseclient
    .channel("players-" + lobbyCode)
    .on("postgres_changes",
      { event: "*", schema: "public", table: "players", filter: `lobby_code=eq.${lobbyCode}` },
      () => {
        if (isHost) refreshHostPlayerList();
        if (isJoiner) refreshPlayerPlayerList();
      }
    )
    .subscribe();
}

let roleCheckInterval = null;

function subscribeToOwnRole() {
  supabaseClient
    .channel("role-" + myPlayerId)
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "players", filter: `id=eq.${myPlayerId}` },
      (payload) => {
        if (payload.new.role) applyRole(payload.new.role);
      }
    )
    .subscribe();

  roleCheckInterval = setInterval(async () => {
    if (myRole) { clearInterval(roleCheckInterval); return; }
    const { data, error } = await supabaseClient
      .from("players")
      .select("role")
      .eq("id", myPlayerId)
      .single();
    if (!error && data && data.role) {
      applyRole(data.role);
      clearInterval(roleCheckInterval);
    }
  }, 4000);
}

function applyRole(role) {
  myRole = role;
  document.getElementById("waitingNote").classList.add("hidden");
  document.getElementById("playerPlayerList").classList.add("hidden");
  document.getElementById("roleBox").classList.remove("hidden");
}

function revealRole() {
  if (!myRole) return;
  roleRevealed = !roleRevealed;
  const hiddenState = document.getElementById("roleHiddenState");
  const shownState = document.getElementById("roleShownState");
  const roleText = document.getElementById("roleText");

  if (roleRevealed) {
    roleText.textContent = "Jouw rol is: " + myRole;
    roleText.className = "role-" + myRole;
    hiddenState.classList.add("hidden");
    shownState.classList.remove("hidden");
  } else {
    hiddenState.classList.remove("hidden");
    shownState.classList.add("hidden");
  }
}
/* ---------------------- CLEANUP ON REFRESH/CLOSE ---------------------- */

function cleanupOnUnload() {
  if (myPlayerId) {
    fetch(`${SUPABASE_URL}/rest/v1/players?id=eq.${myPlayerId}`, {
      method: "DELETE",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      },
      keepalive: true
    });
  }
}

window.addEventListener("pagehide", cleanupOnUnload);
window.addEventListener("beforeunload", cleanupOnUnload);
let heartbeatInterval = null;

function startHeartbeat() {
  heartbeatInterval = setInterval(() => {
    if (myPlayerId) {
      supabaseClient
        .from("players")
        .update({ last_seen: new Date().toISOString() })
        .eq("id", myPlayerId);
    }
  }, 3000);
}