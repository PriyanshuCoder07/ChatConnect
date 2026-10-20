package com.chatconnect.chat;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

@Component
public class ChatWebSocketHandler extends TextWebSocketHandler {
    private static final Logger log = LoggerFactory.getLogger(ChatWebSocketHandler.class);
    private static final Pattern ROOM_CODE = Pattern.compile("[A-Z0-9]{6}");
    private static final int MAX_MESSAGE_LENGTH = 1000;
    private static final int MAX_NAME_LENGTH = 24;

    private final ObjectMapper objectMapper;
    private final Map<String, Room> rooms = new ConcurrentHashMap<>();

    public ChatWebSocketHandler(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws IOException {
        if (message.getPayloadLength() > 4096) {
            sendError(session, "That request is too large.");
            return;
        }

        final JsonNode request;
        try {
            request = objectMapper.readTree(message.getPayload());
        } catch (JsonProcessingException exception) {
            sendError(session, "I couldn't read that request. Please try again.");
            return;
        }

        String type = request.path("type").asText();
        if ("join".equals(type)) {
            joinRoom(session, request);
        } else if ("send".equals(type)) {
            sendChatMessage(session, request);
        } else {
            sendError(session, "Unknown request.");
        }
    }

    private void joinRoom(WebSocketSession session, JsonNode request) throws IOException {
        if (session.getAttributes().containsKey("roomCode")) {
            sendError(session, "You are already in a room.");
            return;
        }

        String roomCode = request.path("roomCode").asText("").trim().toUpperCase();
        String displayName = request.path("displayName").asText("").trim();
        if (!ROOM_CODE.matcher(roomCode).matches()) {
            sendError(session, "Room codes must be 6 letters or numbers.");
            return;
        }
        if (displayName.isBlank() || displayName.length() > MAX_NAME_LENGTH) {
            sendError(session, "Choose a display name from 1 to 24 characters.");
            return;
        }

        Room room = rooms.computeIfAbsent(roomCode, ignored -> new Room());
        synchronized (room) {
            if (room.members.size() >= 2) {
                sendError(session, "That room already has two people.");
                return;
            }

            session.getAttributes().put("roomCode", roomCode);
            session.getAttributes().put("displayName", displayName);
            room.members.put(session.getId(), session);
            Map<String, Object> joined = new LinkedHashMap<>();
            joined.put("type", "joined");
            joined.put("roomCode", roomCode);
            joined.put("participantCount", room.members.size());

            for (WebSocketSession member : new ArrayList<>(room.members.values())) {
                if (!member.getId().equals(session.getId())) {
                    joined.put("peerName", member.getAttributes().get("displayName"));
                    sendJson(member, Map.of("type", "peer_joined", "displayName", displayName));
                }
            }
            sendJson(session, joined);
        }
        log.debug("A participant joined room {}", roomCode);
    }

    private void sendChatMessage(WebSocketSession session, JsonNode request) throws IOException {
        Object roomCodeValue = session.getAttributes().get("roomCode");
        Object displayNameValue = session.getAttributes().get("displayName");
        if (!(roomCodeValue instanceof String roomCode) || !(displayNameValue instanceof String displayName)) {
            sendError(session, "Join a room before sending a message.");
            return;
        }

        String content = request.path("content").asText("").trim();
        if (content.isBlank()) {
            sendError(session, "Type a message first.");
            return;
        }
        if (content.length() > MAX_MESSAGE_LENGTH) {
            sendError(session, "Messages can be up to 1000 characters.");
            return;
        }

        Room room = rooms.get(roomCode);
        if (room == null) {
            sendError(session, "This room has closed. Create or join another room.");
            return;
        }

        Map<String, Object> outgoing = new LinkedHashMap<>();
        outgoing.put("type", "message");
        outgoing.put("from", displayName);
        outgoing.put("content", content);
        outgoing.put("sentAt", Instant.now().toString());
        synchronized (room) {
            if (!room.members.containsKey(session.getId())) {
                sendError(session, "You are no longer connected to this room.");
                return;
            }
            for (WebSocketSession member : new ArrayList<>(room.members.values())) {
                Map<String, Object> delivered = new LinkedHashMap<>(outgoing);
                delivered.put("mine", member.getId().equals(session.getId()));
                sendJson(member, delivered);
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        Object roomCodeValue = session.getAttributes().get("roomCode");
        if (!(roomCodeValue instanceof String roomCode)) {
            return;
        }

        Room room = rooms.get(roomCode);
        if (room == null) {
            return;
        }

        synchronized (room) {
            room.members.remove(session.getId());
            for (WebSocketSession member : new ArrayList<>(room.members.values())) {
                sendJson(member, Map.of("type", "peer_left"));
            }
            if (room.members.isEmpty()) {
                rooms.remove(roomCode, room);
            }
        }
        log.debug("A participant left room {}", roomCode);
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) throws Exception {
        log.debug("WebSocket transport ended: {}", exception.getMessage());
        if (session.isOpen()) {
            session.close(CloseStatus.SERVER_ERROR);
        }
    }

    private void sendError(WebSocketSession session, String message) throws IOException {
        sendJson(session, Map.of("type", "error", "message", message));
    }

    private void sendJson(WebSocketSession session, Object payload) {
        if (!session.isOpen()) {
            return;
        }
        try {
            String json = objectMapper.writeValueAsString(payload);
            synchronized (session) {
                if (session.isOpen()) {
                    session.sendMessage(new TextMessage(json));
                }
            }
        } catch (IOException exception) {
            log.debug("Could not send WebSocket event: {}", exception.getMessage());
        } catch (IllegalStateException exception) {
            log.debug("WebSocket closed before the event could be sent.");
        }
    }

    private static final class Room {
        private final Map<String, WebSocketSession> members = new LinkedHashMap<>();
    }
}
