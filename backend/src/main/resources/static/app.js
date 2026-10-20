(() => {
  const $ = (id) => document.getElementById(id);
  const welcomeView = $("welcomeView");
  const chatView = $("chatView");
  const displayNameInput = $("displayName");
  const roomCodeInput = $("roomCode");
  const entryError = $("entryError");
  const messageInput = $("messageInput");
  const messageList = $("messageList");
  const sendButton = $("sendButton");
  const messageForm = $("messageForm");
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let socket = null;
  let name = "";
  let roomCode = "";
  let connected = false;
  let toastTimer = null;

  function createCode() {
    const values = new Uint32Array(6);
    crypto.getRandomValues(values);
    return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
  }

  function showEntryError(message) {
    entryError.textContent = message;
  }

  function connectToRoom(code) {
    name = displayNameInput.value.trim();
    roomCode = code.trim().toUpperCase();
    if (!name || name.length > 24) {
      showEntryError("Please enter a name (up to 24 characters). ");
      displayNameInput.focus();
      return;
    }
    if (!/^[A-Z0-9]{6}$/.test(roomCode)) {
      showEntryError("Enter a 6-character room code.");
      roomCodeInput.focus();
      return;
    }

    showEntryError("");
    $("createButton").disabled = true;
    $("joinButton").disabled = true;
    socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/chat`);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "join", roomCode, displayName: name }));
    });
    socket.addEventListener("message", (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      handleServerEvent(data);
    });
    socket.addEventListener("close", () => {
      connected = false;
      setChatEnabled(false);
      if (!chatView.classList.contains("hidden")) {
        setConnection("Disconnected", false);
        showToast("Connection closed. Your messages weren’t saved.");
      } else {
        $("createButton").disabled = false;
        $("joinButton").disabled = false;
      }
    });
    socket.addEventListener("error", () => {
      showEntryError("Could not connect. Make sure the ChatConnect server is running.");
      $("createButton").disabled = false;
      $("joinButton").disabled = false;
    });
  }

  function handleServerEvent(data) {
    switch (data.type) {
      case "joined":
        welcomeView.classList.add("hidden");
        chatView.classList.remove("hidden");
        $("roomCodeDisplay").textContent = data.roomCode;
        $("selfName").textContent = name;
        $("selfAvatar").textContent = name.charAt(0).toUpperCase();
        $("peopleCount").textContent = `${data.participantCount} / 2`;
        $("peerName").textContent = data.peerName || "Waiting for them…";
        $("peerStatusDot").classList.toggle("online-dot", Boolean(data.peerName));
        $("peerStatusDot").classList.toggle("waiting-dot", !data.peerName);
        if (data.peerName) {
          $("peopleCount").textContent = "2 / 2";
        }
        connected = true;
        setChatEnabled(true);
        setConnection(data.participantCount === 2 ? "You’re both here" : "Waiting for your person", data.participantCount === 2);
        messageInput.focus();
        break;
      case "peer_joined":
        $("peerName").textContent = data.displayName;
        $("peopleCount").textContent = "2 / 2";
        $("peerStatusDot").classList.remove("waiting-dot");
        $("peerStatusDot").classList.add("online-dot");
        setConnection("You’re both here", true);
        showSystemMessage(`${data.displayName} joined the room`);
        break;
      case "peer_left":
        $("peerName").textContent = "Waiting for them…";
        $("peopleCount").textContent = "1 / 2";
        $("peerStatusDot").classList.remove("online-dot");
        $("peerStatusDot").classList.add("waiting-dot");
        setConnection("Your person left", false);
        showSystemMessage("Your person left. Messages in this room are not kept.");
        break;
      case "message":
        appendMessage(data);
        break;
      case "error":
        if (chatView.classList.contains("hidden")) {
          showEntryError(data.message);
          if (socket) socket.close();
        } else {
          showToast(data.message);
        }
        break;
    }
  }

  function setChatEnabled(enabled) {
    messageInput.disabled = !enabled;
    sendButton.disabled = !enabled;
    connected = enabled;
  }

  function setConnection(label, online) {
    $("connectionLabel").textContent = label;
    $("connectionDot").classList.toggle("is-online", online);
  }

  function appendMessage(data) {
    const welcome = $("conversationStart");
    if (welcome) welcome.remove();
    const own = Boolean(data.mine);
    const row = document.createElement("article");
    row.className = `message-row${own ? " message-own" : ""}`;
    const meta = document.createElement("div");
    meta.className = "message-meta";
    const sender = document.createElement("span");
    sender.textContent = own ? "You" : data.from;
    const time = document.createElement("time");
    time.dateTime = data.sentAt;
    time.textContent = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(data.sentAt));
    meta.append(sender, time);
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.textContent = data.content;
    row.append(meta, bubble);
    messageList.append(row);
    messageList.scrollTop = messageList.scrollHeight;
  }

  function showSystemMessage(text) {
    const welcome = $("conversationStart");
    if (welcome) welcome.remove();
    const line = document.createElement("div");
    line.className = "system-message";
    line.textContent = text;
    messageList.append(line);
    messageList.scrollTop = messageList.scrollHeight;
  }

  function showToast(text) {
    const toast = $("toast");
    toast.textContent = text;
    toast.classList.add("toast-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("toast-visible"), 3000);
  }

  $("createButton").addEventListener("click", () => connectToRoom(createCode()));
  $("joinButton").addEventListener("click", () => connectToRoom(roomCodeInput.value));
  roomCodeInput.addEventListener("input", () => { roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6); });
  displayNameInput.addEventListener("input", () => showEntryError(""));

  messageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const content = messageInput.value.trim();
    if (!content || !connected || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "send", content }));
    messageInput.value = "";
    messageInput.focus();
  });

  $("copyButton").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      showToast("Room code copied. Send it to your person.");
    } catch {
      showToast(`Your room code is ${roomCode}`);
    }
  });

  $("leaveButton").addEventListener("click", () => {
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "left room");
    chatView.classList.add("hidden");
    welcomeView.classList.remove("hidden");
    messageList.innerHTML = '<div class="conversation-start" id="conversationStart"><span class="start-spark">✳</span><b>You’re here.</b><span>Your messages will appear here. They’re only shared live, never saved.</span></div>';
    roomCodeInput.value = "";
    entryError.textContent = "";
    setChatEnabled(false);
    $("createButton").disabled = false;
    $("joinButton").disabled = false;
  });
})();
