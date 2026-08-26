package com.videodownloader.view;

import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Dimension;
import java.awt.Desktop;
import java.awt.FlowLayout;
import java.awt.Font;
import java.awt.GridLayout;
import java.awt.Insets;
import java.awt.Rectangle;
import java.awt.Toolkit;
import java.awt.datatransfer.Clipboard;
import java.awt.datatransfer.DataFlavor;
import java.awt.datatransfer.StringSelection;
import java.awt.event.KeyAdapter;
import java.awt.event.KeyEvent;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.awt.event.MouseMotionAdapter;
import java.io.File;
import java.net.URL;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.swing.BorderFactory;
import javax.swing.DefaultListSelectionModel;
import javax.swing.JButton;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTable;
import javax.swing.JTextArea;
import javax.swing.JTextField;
import javax.swing.RowFilter;
import javax.swing.SwingConstants;
import javax.swing.SwingUtilities;
import javax.swing.Timer;
import javax.swing.UIManager;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import javax.swing.table.DefaultTableCellRenderer;
import javax.swing.table.DefaultTableModel;
import javax.swing.table.TableRowSorter;

import com.videodownloader.controller.AppLogger;
import com.videodownloader.controller.BrowserController;
import com.videodownloader.controller.DownloadManager;
import com.videodownloader.controller.UpdateChecker;

public class AppGUI extends JFrame {
	private static final long serialVersionUID = 1L;
	private JTextField urlInput;
	private JButton btnClipboard, btnHunt, btnImportApi;
	private DefaultTableModel tableModel;
	private JTable queueTable;
	private TableRowSorter<DefaultTableModel> sorter;
	private JTextField searchField;
	private JTextArea consoleLog;
	private JPanel consolePanel;
	private JLabel statusDot, statusLabel;
	private JButton btnToggleDetails;
	private Timer statusResetTimer;
	private Consumer<String> diagnosticLogListener;
	private JButton btnDownloadSelected, btnClearAll;

	private final DownloadManager manager;

	private int hoveredRow = -1;
	private int hoveredCol = -1;

	public AppGUI(DownloadManager manager) {
		this.manager = manager;
		AppLogger.install();

		setTitle("Video Downloader - " + UpdateChecker.getCurrentVersion());
		try {
			URL iconUrl = getClass().getResource("/logo.png");
			if (iconUrl != null) {
				setIconImage(Toolkit.getDefaultToolkit().getImage(iconUrl));
			}
		} catch (Exception e) {
			// Ignore
		}
		setSize(1050, 660);
		setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
		setLocationRelativeTo(null);
		setLayout(new BorderLayout(10, 10));

		JPanel topPanel = new JPanel(new BorderLayout(10, 10));
		topPanel.setBorder(BorderFactory.createEmptyBorder(12, 12, 0, 12));

		JPanel inputPanel = new JPanel(new BorderLayout(8, 0));
		JLabel urlLabel = new JLabel("URL:");
		urlLabel.setFont(urlLabel.getFont().deriveFont(Font.BOLD));
		inputPanel.add(urlLabel, BorderLayout.WEST);
		urlInput = new JTextField();
		urlInput.setToolTipText("Paste a video URL here, or leave empty to open a capture browser");
		inputPanel.add(urlInput, BorderLayout.CENTER);

		JPanel btnPanel = new JPanel(new FlowLayout(FlowLayout.RIGHT, 6, 0));
		btnImportApi = new JButton("Import List");
		btnImportApi.setToolTipText("Import a JSON episode list for bulk downloads");
		btnClipboard = new JButton("Paste Link");
		btnClipboard.setToolTipText("Parse video URLs from clipboard content");

		btnHunt = new JButton("Hunt / Download");
		btnHunt.setToolTipText("Detect stream URL via browser extension, or download directly");
		btnHunt.putClientProperty("JButton.buttonType", "roundRect");
		btnPanel.add(btnImportApi);
		btnPanel.add(btnClipboard);
		btnPanel.add(btnHunt);

		topPanel.add(inputPanel, BorderLayout.CENTER);
		topPanel.add(btnPanel, BorderLayout.EAST);

		JPanel queuePanel = new JPanel(new BorderLayout());
		queuePanel.setBorder(BorderFactory.createTitledBorder("Download Queue"));

		JPanel searchPanel = new JPanel(new BorderLayout(8, 0));
		searchPanel.setBorder(BorderFactory.createEmptyBorder(4, 8, 6, 8));
		searchField = new JTextField();
		searchField.putClientProperty("JTextField.placeholderText", "Search by name or link...");
		searchField.setToolTipText("Filter the download queue");
		searchPanel.add(new JLabel("Search:"), BorderLayout.WEST);
		searchPanel.add(searchField, BorderLayout.CENTER);
		queuePanel.add(searchPanel, BorderLayout.NORTH);

		String[] columns = { "No.", "Name / Link", "Format", "Status", "Progress", " " };
		tableModel = new DefaultTableModel(columns, 0) {
			@Override
			public boolean isCellEditable(int row, int column) {
				return false;
			}
		};
		queueTable = new JTable(tableModel) {
			@Override
			public String getToolTipText(MouseEvent e) {
				int r = rowAtPoint(e.getPoint());
				int c = columnAtPoint(e.getPoint());
				if (r >= 0 && c == 1) {
					Object v = getValueAt(r, c);
					return v == null ? null : v.toString();
				}
				return super.getToolTipText(e);
			}
		};

		queueTable.setSelectionModel(new DefaultListSelectionModel() {
			private static final long serialVersionUID = 1L;

			@Override
			public void setSelectionInterval(int index0, int index1) {
				if (super.isSelectedIndex(index0)) {
					super.removeSelectionInterval(index0, index1);
				} else {
					super.addSelectionInterval(index0, index1);
				}
			}
		});

		sorter = new TableRowSorter<>(tableModel);
		for (int i = 0; i < tableModel.getColumnCount(); i++) {
			sorter.setSortable(i, false);
		}
		queueTable.setRowSorter(sorter);

		searchField.getDocument().addDocumentListener(new DocumentListener() {
			private void applyFilter() {
				String query = searchField.getText().trim();
				if (query.isEmpty()) {
					sorter.setRowFilter(null);
				} else {
					sorter.setRowFilter(RowFilter.regexFilter("(?i)" + Pattern.quote(query), 1));
				}
			}

			@Override
			public void insertUpdate(DocumentEvent e) {
				applyFilter();
			}

			@Override
			public void removeUpdate(DocumentEvent e) {
				applyFilter();
			}

			@Override
			public void changedUpdate(DocumentEvent e) {
				applyFilter();
			}
		});

		queueTable.setRowHeight(30);
		queueTable.setShowHorizontalLines(false);
		queueTable.setShowVerticalLines(false);
		queueTable.setIntercellSpacing(new Dimension(0, 1));
		queueTable.setFillsViewportHeight(true);
		queueTable.getTableHeader().setReorderingAllowed(false);

		queueTable.getColumnModel().getColumn(0).setPreferredWidth(50);
		queueTable.getColumnModel().getColumn(0).setMaxWidth(50);
		DefaultTableCellRenderer centerRenderer = new DefaultTableCellRenderer();
		centerRenderer.setHorizontalAlignment(SwingConstants.CENTER);
		queueTable.getColumnModel().getColumn(0).setCellRenderer(centerRenderer);
		DefaultTableCellRenderer centerHeaderRenderer = new DefaultTableCellRenderer();
		centerHeaderRenderer.setHorizontalAlignment(SwingConstants.CENTER);
		centerHeaderRenderer.setBorder(UIManager.getBorder("TableHeader.cellBorder"));
		queueTable.getColumnModel().getColumn(0).setHeaderRenderer(centerHeaderRenderer);
		queueTable.getColumnModel().getColumn(2).setPreferredWidth(70);
		queueTable.getColumnModel().getColumn(2).setMaxWidth(70);
		queueTable.getColumnModel().getColumn(3).setPreferredWidth(110);
		queueTable.getColumnModel().getColumn(3).setMaxWidth(130);
		ProgressRenderer progressRenderer = new ProgressRenderer();
		queueTable.getColumnModel().getColumn(4).setCellRenderer(progressRenderer);

		queueTable.getColumnModel().getColumn(5).setPreferredWidth(130);
		queueTable.getColumnModel().getColumn(5).setMaxWidth(130);
		ActionButtonsRenderer actionBtnRenderer = new ActionButtonsRenderer();
		queueTable.getColumnModel().getColumn(5).setCellRenderer(actionBtnRenderer);

		queueTable.addMouseMotionListener(new MouseMotionAdapter() {
			@Override
			public void mouseMoved(MouseEvent e) {
				int row = queueTable.rowAtPoint(e.getPoint());
				int col = queueTable.columnAtPoint(e.getPoint());

				if (row != hoveredRow || col != hoveredCol || col == 5) {
					int oldRow = hoveredRow;
					int oldCol = hoveredCol;

					hoveredRow = row;
					hoveredCol = col;

					if (row >= 0 && col == 5) {
						java.awt.Rectangle cellRect = queueTable.getCellRect(row, col, false);
						int xInCell = e.getX() - cellRect.x;
						actionBtnRenderer.updateHoverState(row, col, xInCell);
					} else {
						actionBtnRenderer.updateHoverState(-1, -1, -1);
					}

					if (oldRow >= 0 && oldCol == 5) {
						queueTable.repaint(queueTable.getCellRect(oldRow, oldCol, false));
					}
					if (hoveredRow >= 0 && hoveredCol == 5) {
						queueTable.repaint(queueTable.getCellRect(hoveredRow, hoveredCol, false));
					}
				}
			}
		});

		queueTable.addMouseListener(new MouseAdapter() {
			@Override
			public void mouseExited(MouseEvent e) {
				int oldRow = hoveredRow;
				int oldCol = hoveredCol;

				hoveredRow = -1;
				hoveredCol = -1;
				actionBtnRenderer.updateHoverState(-1, -1, -1);

				if (oldRow >= 0 && oldCol == 5) {
					queueTable.repaint(queueTable.getCellRect(oldRow, oldCol, false));
				}
			}

			@Override
			public void mouseClicked(MouseEvent e) {
				int column = queueTable.columnAtPoint(e.getPoint());
				int viewRow = queueTable.rowAtPoint(e.getPoint());

				if (viewRow < queueTable.getRowCount() && viewRow >= 0 && column == 5) {
					int row = queueTable.convertRowIndexToModel(viewRow);
					String status = tableModel.getValueAt(row, 3).toString();
					if (status.equals("Downloading...") || status.equals("Loading...")) {
						logToConsole("=> [System] Cannot modify an active download!");
						return;
					}

					Rectangle cellRect = queueTable.getCellRect(viewRow, column, false);
					int xInCell = e.getX() - cellRect.x;
					int mid = cellRect.width / 2;

					if (xInCell < mid) {
						// Clicked Trim
						manager.openTrimDialog(row);
					} else {
						// Clicked Remove
						manager.removePendingTask(row);
						tableModel.removeRow(row);

						for (int i = 0; i < tableModel.getRowCount(); i++) {
							tableModel.setValueAt(i + 1, i, 0);
						}
						logToConsole("=> [System] Removed item from queue.");

						hoveredRow = -1;
						hoveredCol = -1;
						actionBtnRenderer.updateHoverState(-1, -1, -1);
					}
				}
			}
		});

		JScrollPane tableScroll = new JScrollPane(queueTable);
		queuePanel.add(tableScroll, BorderLayout.CENTER);

		JPanel bottomContainer = new JPanel(new BorderLayout(5, 5));
		bottomContainer.setBorder(BorderFactory.createEmptyBorder(0, 12, 12, 12));

		consolePanel = new JPanel(new BorderLayout(0, 4));
		consolePanel.setBorder(BorderFactory.createTitledBorder("Technical details"));
		consoleLog = new JTextArea(7, 50);
		consoleLog.setEditable(false);
		consoleLog.setBackground(new Color(28, 28, 28));
		consoleLog.setForeground(new Color(190, 205, 190));
		consoleLog.setFont(new Font("Monospaced", Font.PLAIN, 12));
		consoleLog.setMargin(new Insets(4, 6, 4, 6));
		consolePanel.add(new JScrollPane(consoleLog), BorderLayout.CENTER);

		JButton btnCopyDetails = new JButton("Copy details");
		JButton btnOpenLogs = new JButton("Open log folder");
		JPanel detailActions = new JPanel(new FlowLayout(FlowLayout.RIGHT, 6, 0));
		detailActions.add(btnCopyDetails);
		detailActions.add(btnOpenLogs);
		consolePanel.add(detailActions, BorderLayout.SOUTH);
		consolePanel.setVisible(false);

		JPanel actionPanel = new JPanel(new BorderLayout(0, 5));
		JPanel statusPanel = new JPanel(new BorderLayout(8, 0));
		statusPanel.setBorder(BorderFactory.createEmptyBorder(3, 4, 3, 0));
		statusDot = new JLabel("●");
		statusLabel = new JLabel("Ready");
		btnToggleDetails = new JButton("Show details");
		btnToggleDetails.setToolTipText("Show technical logs for troubleshooting");
		statusPanel.add(statusDot, BorderLayout.WEST);
		statusPanel.add(statusLabel, BorderLayout.CENTER);
		statusPanel.add(btnToggleDetails, BorderLayout.EAST);
		setStatusAppearance(NoticeType.INFO);

		btnDownloadSelected = new JButton("Start Selected");
		btnDownloadSelected.setToolTipText("Start downloading all selected items in the queue");
		btnDownloadSelected.putClientProperty("JButton.buttonType", "roundRect");

		btnClearAll = new JButton("Clear All");
		btnClearAll.setToolTipText("Remove every item from the queue (active downloads are kept)");
		btnClearAll.putClientProperty("JButton.buttonType", "roundRect");

		JPanel actionButtons = new JPanel(new GridLayout(1, 2, 8, 0));
		actionButtons.add(btnClearAll);
		actionButtons.add(btnDownloadSelected);
		actionPanel.add(statusPanel, BorderLayout.CENTER);
		actionPanel.add(actionButtons, BorderLayout.SOUTH);

		bottomContainer.add(consolePanel, BorderLayout.CENTER);
		bottomContainer.add(actionPanel, BorderLayout.SOUTH);

		consoleLog.setText(AppLogger.getRecentText());
		diagnosticLogListener = this::appendDiagnosticLine;
		AppLogger.addListener(diagnosticLogListener);

		btnToggleDetails.addActionListener(e -> {
			boolean show = !consolePanel.isVisible();
			consolePanel.setVisible(show);
			btnToggleDetails.setText(show ? "Hide details" : "Show details");
			bottomContainer.revalidate();
			bottomContainer.repaint();
		});
		btnCopyDetails.addActionListener(e -> copyDiagnosticDetails());
		btnOpenLogs.addActionListener(e -> openLogFolder());

		add(topPanel, BorderLayout.NORTH);
		add(queuePanel, BorderLayout.CENTER);
		add(bottomContainer, BorderLayout.SOUTH);

		btnHunt.addActionListener(e -> startHunting());

		urlInput.addKeyListener(new KeyAdapter() {
			@Override
			public void keyPressed(KeyEvent e) {
				if (e.getKeyCode() == KeyEvent.VK_ENTER) {
					startHunting();
				}
			}
		});

		btnDownloadSelected.addActionListener(e -> {
			int[] selectedRows = queueTable.getSelectedRows();
			if (selectedRows.length == 0) {
				JOptionPane.showMessageDialog(this, "Select at least one item to download.", "Nothing selected",
						JOptionPane.WARNING_MESSAGE);
				return;
			}
			logToConsole("=> Starting " + selectedRows.length + " selected items...");

			for (int viewRow : selectedRows) {
				int row = queueTable.convertRowIndexToModel(viewRow);
				String status = tableModel.getValueAt(row, 3).toString();
				if (status.equals("Downloading...") || status.equals("Loading...") || status.equals("Completed")) {
					continue;
				}
				manager.enqueuePendingTask(row);
				updateQueueItemStatus(row, "In Queue", "0%");
			}
			queueTable.clearSelection();
		});

		btnClearAll.addActionListener(e -> {
			if (tableModel.getRowCount() == 0) {
				logToConsole("=> [System] Queue is already empty.");
				return;
			}
			int confirm = JOptionPane.showConfirmDialog(this,
					"Remove all items from the queue?\n(Active downloads will be kept)", "Clear All",
					JOptionPane.YES_NO_OPTION, JOptionPane.QUESTION_MESSAGE);
			if (confirm != JOptionPane.YES_OPTION) {
				return;
			}

			int removed = 0;
			for (int row = tableModel.getRowCount() - 1; row >= 0; row--) {
				String status = tableModel.getValueAt(row, 3).toString();
				if (status.equals("Downloading...") || status.equals("Loading...")) {
					continue;
				}
				manager.removePendingTask(row);
				tableModel.removeRow(row);
				removed++;
			}
			for (int i = 0; i < tableModel.getRowCount(); i++) {
				tableModel.setValueAt(i + 1, i, 0);
			}
			logToConsole("=> [System] Cleared " + removed + " item(s) from queue.");
		});

		btnImportApi.addActionListener(e -> {
			JTextArea jsonArea = new JTextArea(15, 60);
			jsonArea.setLineWrap(true);
			JScrollPane scrollPane = new JScrollPane(jsonArea);

			int result = JOptionPane.showConfirmDialog(this, scrollPane, "Import video list",
					JOptionPane.OK_CANCEL_OPTION, JOptionPane.PLAIN_MESSAGE);

			if (result == JOptionPane.OK_OPTION) {
				String jsonContent = jsonArea.getText().trim();
				if (!jsonContent.isEmpty()) {
					logToConsole("=> [System] Parsing API JSON...");
					manager.processApiJson(jsonContent);
				}
			}
		});

		btnClipboard.addActionListener(e -> {
			try {
				Clipboard clipboard = Toolkit.getDefaultToolkit().getSystemClipboard();
				if (clipboard.isDataFlavorAvailable(DataFlavor.stringFlavor)) {
					String data = (String) clipboard.getData(DataFlavor.stringFlavor);
					if (data != null && !data.trim().isEmpty()) {
						Matcher m = Pattern.compile("(?i)https?://[^\\s]+").matcher(data);
						boolean found = false;
						while (m.find()) {
							found = true;
							String url = m.group();
							logToConsole("=> [Clipboard] Manual catch: " + url);
							manager.processLink(url);
						}

						if (!found) {
							String preview = data.length() > 30 ? data.substring(0, 30) + "..." : data;
							logToConsole("=> [Clipboard] No valid link found. Copied text was: '" + preview + "'");
						}
					} else {
						logToConsole("=> [Clipboard] Clipboard is empty.");
					}
				}
			} catch (Exception ex) {
				logToConsole("=> [Error] Cannot access clipboard: " + ex.getMessage());
			}
		});
	}

	private void startHunting() {
		String movieUrl = urlInput.getText().trim();
		String lowerUrl = movieUrl.toLowerCase();

		if (movieUrl.isEmpty()) {
			logToConsole("=> [Hunter] Opening the capture browser for manual browsing...");
			BrowserController.openCaptureBrowser("");
			return;
		}

		if (lowerUrl.contains("youtube.com") || lowerUrl.contains("youtu.be") || lowerUrl.contains("tiktok.com")
				|| lowerUrl.contains("facebook.com") || lowerUrl.contains("instagram.com")) {
			logToConsole("=> [System] Detected native platform. Direct download...");
			manager.processLink(movieUrl);
		} else {
			logToConsole("=> [Hunter] Opening the capture browser...");
			BrowserController.openCaptureBrowser(movieUrl);
		}

		urlInput.setText("");
	}

	public void logToConsole(String message) {
		System.out.println(message);
		showNotice(toUserFacingMessage(message), inferNoticeType(message));
	}

	private void appendDiagnosticLine(String line) {
		SwingUtilities.invokeLater(() -> {
			consoleLog.append(line + "\n");
			int excess = consoleLog.getDocument().getLength() - 100_000;
			if (excess > 0) {
				try {
					consoleLog.getDocument().remove(0, excess);
				} catch (javax.swing.text.BadLocationException ignored) {
				}
			}
			consoleLog.setCaretPosition(consoleLog.getDocument().getLength());
		});
	}

	private void showNotice(String message, NoticeType type) {
		if (!SwingUtilities.isEventDispatchThread()) {
			SwingUtilities.invokeLater(() -> showNotice(message, type));
			return;
		}
		statusLabel.setText(message == null || message.isBlank() ? "Ready" : message);
		setStatusAppearance(type);
		if (type == NoticeType.ERROR && !consolePanel.isVisible()) {
			btnToggleDetails.setText("View error details");
		}
		if (statusResetTimer != null) {
			statusResetTimer.stop();
		}
		statusResetTimer = new Timer(type == NoticeType.ERROR ? 10_000 : 6_000, e -> {
			statusLabel.setText("Ready");
			setStatusAppearance(NoticeType.INFO);
			btnToggleDetails.setText(consolePanel.isVisible() ? "Hide details" : "Show details");
		});
		statusResetTimer.setRepeats(false);
		statusResetTimer.start();
	}

	private void setStatusAppearance(NoticeType type) {
		Color color = switch (type) {
		case SUCCESS -> new Color(86, 190, 112);
		case WARNING -> new Color(232, 176, 72);
		case ERROR -> new Color(225, 92, 92);
		case INFO -> new Color(105, 165, 225);
		};
		statusDot.setForeground(color);
		statusLabel.setForeground(color);
	}

	private static NoticeType inferNoticeType(String message) {
		String lower = message == null ? "" : message.toLowerCase();
		if (lower.contains("error") || lower.contains("failed") || lower.contains("cannot")) {
			return NoticeType.ERROR;
		}
		if (lower.contains("completed") || lower.contains("success")) {
			return NoticeType.SUCCESS;
		}
		if (lower.contains("warning") || lower.contains("no valid") || lower.contains("canceled")
				|| lower.contains("skip")) {
			return NoticeType.WARNING;
		}
		return NoticeType.INFO;
	}

	private static String toUserFacingMessage(String message) {
		String value = message == null ? "" : message.trim();
		String lower = value.toLowerCase();
		if (lower.contains("download completed")) {
			return "Download completed. The file is ready.";
		}
		if (lower.contains("download failed") || lower.contains("queue error")) {
			return "The download could not be completed. Open Details for more information.";
		}
		if (lower.contains("added captured link")) {
			return "Captured video added to the queue.";
		}
		if (lower.contains("handling link")) {
			return "Preparing the selected download...";
		}
		if (lower.contains("detected native platform")) {
			return "Analyzing the link...";
		}
		if (lower.contains("opening the capture browser") || lower.contains("launching")) {
			return "Opening the capture browser...";
		}
		if (lower.contains("parsing api json")) {
			return "Reading the imported video list...";
		}
		if (lower.contains("manual catch")) {
			return "A video link was found in the clipboard.";
		}
		if (lower.contains("no valid link")) {
			return "The clipboard does not contain a supported link.";
		}

		String cleaned = value.replaceFirst("^\\s*(?:=>|>>)?\\s*", "");
		while (cleaned.matches("^\\[[^]]+]\\s*.*")) {
			cleaned = cleaned.replaceFirst("^\\[[^]]+]\\s*", "");
		}
		if (cleaned.length() > 160) {
			cleaned = cleaned.substring(0, 157) + "...";
		}
		return cleaned.isBlank() ? "Ready" : cleaned;
	}

	private void copyDiagnosticDetails() {
		String details = consoleLog.getText();
		if (details.isBlank()) {
			showNotice("There are no technical details to copy.", NoticeType.WARNING);
			return;
		}
		try {
			Toolkit.getDefaultToolkit().getSystemClipboard().setContents(new StringSelection(details), null);
			showNotice("Technical details copied to the clipboard.", NoticeType.SUCCESS);
		} catch (Exception e) {
			System.err.println("[UI] Could not copy technical details: " + e.getMessage());
			showNotice("Could not copy the technical details.", NoticeType.ERROR);
		}
	}

	private void openLogFolder() {
		File logFile = AppLogger.getLogFile();
		try {
			if (!Desktop.isDesktopSupported() || logFile.getParentFile() == null) {
				throw new IllegalStateException("Opening folders is not supported on this system");
			}
			Desktop.getDesktop().open(logFile.getParentFile());
			showNotice("Log folder opened.", NoticeType.SUCCESS);
		} catch (Exception e) {
			System.err.println("[UI] Could not open log folder " + logFile.getParent() + ": " + e.getMessage());
			showNotice("Could not open the folder. Log: " + logFile.getAbsolutePath(), NoticeType.ERROR);
		}
	}

	@Override
	public void dispose() {
		AppLogger.removeListener(diagnosticLogListener);
		super.dispose();
	}

	private enum NoticeType {
		INFO, SUCCESS, WARNING, ERROR
	}

	public int addQueueItem(String url, String format, String status) {
		int stt = tableModel.getRowCount() + 1;
		tableModel.addRow(new Object[] { stt, url, format, status, "0%", "" });
		return tableModel.getRowCount() - 1;
	}

	public void updateQueueItemName(int rowIndex, String name) {
		SwingUtilities.invokeLater(() -> {
			if (rowIndex >= 0 && rowIndex < tableModel.getRowCount() && name != null && !name.isBlank()) {
				tableModel.setValueAt(name, rowIndex, 1);
			}
		});
	}

	public void updateQueueItemStatus(int rowIndex, String status, String progress) {
		SwingUtilities.invokeLater(() -> {
			if (rowIndex >= 0 && rowIndex < tableModel.getRowCount()) {
				tableModel.setValueAt(status, rowIndex, 3);
				tableModel.setValueAt(progress, rowIndex, 4);
			}
		});
	}

	public void updateQueueItemFormat(int rowIndex, String format) {
		SwingUtilities.invokeLater(() -> {
			if (rowIndex >= 0 && rowIndex < tableModel.getRowCount()) {
				tableModel.setValueAt(format, rowIndex, 2);
			}
		});
	}

	public int getRowCount() {
		return tableModel.getRowCount();
	}

}
