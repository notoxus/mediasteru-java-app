package com.mediasteru.view;

import java.awt.Component;

import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.BoxLayout;
import javax.swing.ButtonGroup;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JComboBox;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JRadioButton;
import javax.swing.JScrollPane;

public class DownloadOptionsDialog {

	public static class Options {
		public final String format; // mp4 | mp3 | mkv
		public final String quality; // 360 | 720 | 1080 | 1440 | 2160 | best

		private Options(String format, String quality) {
			this.format = format;
			this.quality = quality;
		}
	}

	public static Options show(String message) {
		JRadioButton rbMp4 = new JRadioButton("MP4 — Video (recommended)", true);
		JRadioButton rbMp3 = new JRadioButton("MP3 — Audio only");
		JRadioButton rbMkv = new JRadioButton("MKV — Original quality");
		JComboBox<String> qualitySelect = new JComboBox<>(new String[] {
				"1080p (recommended)", "720p", "360p", "1440p", "2160p", "Best available"
		});
		ButtonGroup formatGroup = new ButtonGroup();
		formatGroup.add(rbMp4);
		formatGroup.add(rbMp3);
		formatGroup.add(rbMkv);

		JPanel panel = new JPanel();
		panel.setLayout(new BoxLayout(panel, BoxLayout.Y_AXIS));
		JLabel msg = new JLabel("<html>" + escapeHtml(message).replace("\n", "<br>") + "</html>");
		JLabel qualityLabel = new JLabel("Video quality:");
		for (JComponent c : new JComponent[] { msg, rbMp4, rbMp3, rbMkv, qualityLabel, qualitySelect }) {
			c.setAlignmentX(Component.LEFT_ALIGNMENT);
		}
		panel.add(msg);
		panel.add(Box.createVerticalStrut(12));
		panel.add(rbMp4);
		panel.add(rbMp3);
		panel.add(rbMkv);
		panel.add(Box.createVerticalStrut(8));
		panel.add(qualityLabel);
		panel.add(qualitySelect);

		JScrollPane scrollPane = new JScrollPane(panel);
		scrollPane.setBorder(BorderFactory.createEmptyBorder());
		int result = JOptionPane.showConfirmDialog(null, scrollPane, "Download Options", JOptionPane.OK_CANCEL_OPTION,
				JOptionPane.PLAIN_MESSAGE);
		if (result != JOptionPane.OK_OPTION) {
			return null;
		}

		String format = rbMp3.isSelected() ? "mp3" : (rbMkv.isSelected() ? "mkv" : "mp4");
		String quality = switch (qualitySelect.getSelectedIndex()) {
		case 1 -> "720";
		case 2 -> "360";
		case 3 -> "1440";
		case 4 -> "2160";
		case 5 -> "best";
		default -> "1080";
		};
		return new Options(format, quality);
	}

	private static String escapeHtml(String s) {
		return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
	}
}
