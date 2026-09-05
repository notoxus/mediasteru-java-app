package com.mediasteru.view;

import java.awt.Component;

import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.BoxLayout;
import javax.swing.ButtonGroup;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JRadioButton;
import javax.swing.JScrollPane;

public class DownloadOptionsDialog {

	public static class Options {
		public final String format; // mp4 | mp3 | mkv

		private Options(String format) {
			this.format = format;
		}
	}

	public static Options show(String message) {
		JRadioButton rbMp4 = new JRadioButton("MP4 — Video (recommended)", true);
		JRadioButton rbMp3 = new JRadioButton("MP3 — Audio only");
		JRadioButton rbMkv = new JRadioButton("MKV — Original quality");
		ButtonGroup formatGroup = new ButtonGroup();
		formatGroup.add(rbMp4);
		formatGroup.add(rbMp3);
		formatGroup.add(rbMkv);

		JPanel panel = new JPanel();
		panel.setLayout(new BoxLayout(panel, BoxLayout.Y_AXIS));
		JLabel msg = new JLabel("<html>" + escapeHtml(message).replace("\n", "<br>") + "</html>");
		for (JComponent c : new JComponent[] { msg, rbMp4, rbMp3, rbMkv }) {
			c.setAlignmentX(Component.LEFT_ALIGNMENT);
		}
		panel.add(msg);
		panel.add(Box.createVerticalStrut(12));
		panel.add(rbMp4);
		panel.add(rbMp3);
		panel.add(rbMkv);

		JScrollPane scrollPane = new JScrollPane(panel);
		scrollPane.setBorder(BorderFactory.createEmptyBorder());
		int result = JOptionPane.showConfirmDialog(null, scrollPane, "Download Options", JOptionPane.OK_CANCEL_OPTION,
				JOptionPane.PLAIN_MESSAGE);
		if (result != JOptionPane.OK_OPTION) {
			return null;
		}

		String format = rbMp3.isSelected() ? "mp3" : (rbMkv.isSelected() ? "mkv" : "mp4");
		return new Options(format);
	}

	private static String escapeHtml(String s) {
		return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
	}
}
