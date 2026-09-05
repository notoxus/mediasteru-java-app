package com.mediasteru.controller;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Executors;

import com.google.gson.JsonObject;
import com.google.gson.JsonElement;
import com.google.gson.JsonParser;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

public class LocalHttpServer {
	public static final int DEFAULT_PORT = 8765;
	private final DownloadManager manager;
	private HttpServer server;

	public LocalHttpServer(DownloadManager manager) {
		this.manager = manager;
	}

	public void start() {
		try {
			server = HttpServer.create(new InetSocketAddress("0.0.0.0", DEFAULT_PORT), 0);
			server.createContext("/capture", new CaptureHandler());
			server.createContext("/add", new AddLinkHandler());
			server.createContext("/ping", new PingHandler());
			server.setExecutor(Executors.newCachedThreadPool());
			server.start();
			System.out.println("Open at " + DEFAULT_PORT + "port. Extension had already listened!");
			logCompanionAddress();
		} catch (IOException e) {
			System.err.println("Couldn't start Local Server: " + e.getMessage());
		}
	}

	private void logCompanionAddress() {
		String ip = findLanAddress();
		if (ip != null) {
			System.out.println("[Companion] Phone companion can reach this PC at: http://" + ip + ":" + DEFAULT_PORT);
		}
	}

	private static String findLanAddress() {
		try {
			Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
			while (ifaces.hasMoreElements()) {
				NetworkInterface iface = ifaces.nextElement();
				if (!iface.isUp() || iface.isLoopback() || iface.isVirtual()) {
					continue;
				}
				Enumeration<InetAddress> addrs = iface.getInetAddresses();
				while (addrs.hasMoreElements()) {
					InetAddress addr = addrs.nextElement();
					if (addr.isSiteLocalAddress() && addr.getHostAddress().indexOf(':') < 0) {
						return addr.getHostAddress();
					}
				}
			}
		} catch (Exception ignored) {
		}
		return null;
	}

	private static void respondJson(HttpExchange ex, int status, String json) throws IOException {
		byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
		ex.getResponseHeaders().set("Content-Type", "application/json");
		ex.sendResponseHeaders(status, bytes.length);
		try (OutputStream os = ex.getResponseBody()) {
			os.write(bytes);
		}
	}

	private static void applyCors(HttpExchange ex) {
		ex.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
		ex.getResponseHeaders().set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
		ex.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type");
	}

	private class PingHandler implements HttpHandler {
		@Override
		public void handle(HttpExchange ex) throws IOException {
			applyCors(ex);
			respondJson(ex, 200, "{\"app\":\"MediaSteru\",\"status\":\"ok\"}");
		}
	}

	private class AddLinkHandler implements HttpHandler {
		@Override
		public void handle(HttpExchange ex) throws IOException {
			applyCors(ex);
			if ("OPTIONS".equalsIgnoreCase(ex.getRequestMethod())) {
				ex.sendResponseHeaders(204, -1);
				return;
			}
			if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
				ex.sendResponseHeaders(405, -1);
				return;
			}

			String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
			try {
				JsonObject json = JsonParser.parseString(body).getAsJsonObject();
				String url = json.get("url").getAsString();
				String from = ex.getRemoteAddress().getAddress().getHostAddress();

				System.out.println("\n[Companion] Link from phone (" + from + "): " + url);
				respondJson(ex, 200, "{\"status\":\"ok\"}");

				manager.processLink(url);
			} catch (Exception e) {
				System.err.println("[Companion] Bad request: " + e.getMessage());
				respondJson(ex, 400, "{\"status\":\"error\"}");
			}
		}
	}

	private class CaptureHandler implements HttpHandler {
		@Override
		public void handle(HttpExchange ex) throws IOException {
			applyCors(ex);

			if ("OPTIONS".equalsIgnoreCase(ex.getRequestMethod())) {
				ex.sendResponseHeaders(204, -1);
				return;
			}

			if ("POST".equalsIgnoreCase(ex.getRequestMethod())) {
				String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
				try {
					JsonObject json = JsonParser.parseString(body).getAsJsonObject();
					String streamUrl = json.get("url").getAsString();
					String referer = json.has("referer") && !json.get("referer").isJsonNull()
							? json.get("referer").getAsString()
							: null;
					Map<String, String> requestHeaders = new LinkedHashMap<>();
					if (json.has("headers") && json.get("headers").isJsonObject()) {
						for (Map.Entry<String, JsonElement> entry : json.getAsJsonObject("headers").entrySet()) {
							if (entry.getValue() != null && !entry.getValue().isJsonNull()) {
								requestHeaders.put(entry.getKey(), entry.getValue().getAsString());
							}
						}
					}

					System.out.println("\n[Extension] Captured URL: " + streamUrl);
					respondJson(ex, 200, "{\"status\":\"ok\"}");

					manager.processAutoCapture(streamUrl, referer, requestHeaders);

				} catch (Exception e) {
					System.err.println("[Error] Failed to process request: " + e.getMessage());
					respondJson(ex, 400, "{\"status\":\"error\",\"message\":\"" + e.getMessage() + "\"}");
				}
			} else {
				ex.sendResponseHeaders(405, -1);
			}
		}
	}
}
