package com.mediasteru.view;

import java.awt.Color;
import java.awt.Component;
import java.awt.Desktop;
import java.awt.Dimension;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.lang.reflect.InvocationTargetException;
import java.net.URI;
import java.util.List;

import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.BoxLayout;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.SwingUtilities;

import com.mediasteru.controller.MediaProbe;
import com.formdev.flatlaf.util.UIScale;

public class TrimDialog {

	public static class TrimOptions {
		public final String trimSection;
		public final boolean preciseCut;

		public TrimOptions(String trimSection, boolean preciseCut) {
			this.trimSection = trimSection;
			this.preciseCut = preciseCut;
		}
	}

	public static TrimOptions show(String title, String url, int durationHint, String refererUrl, boolean isAudio) {
		if (SwingUtilities.isEventDispatchThread()) {
			return showImpl(title, url, durationHint, refererUrl, isAudio);
		}
		final TrimOptions[] holder = new TrimOptions[1];
		try {
			SwingUtilities.invokeAndWait(() -> holder[0] = showImpl(title, url, durationHint, refererUrl, isAudio));
		} catch (InterruptedException | InvocationTargetException e) {
			Thread.currentThread().interrupt();
		}
		return holder[0];
	}

	private static TrimOptions showImpl(String title, String url, int durationHint, String refererUrl, boolean isAudio) {
		JCheckBox cbPrecise = new JCheckBox("Frame-accurate cut (slower)");
		
		FilmstripPanel filmstrip = new FilmstripPanel();
		RangeSlider slider = new RangeSlider();
		slider.setEnabled(false);
		JLabel rangeLabel = new JLabel(" ");
		JLabel statusLabel = new JLabel("Loading media info...");
		statusLabel.setForeground(new Color(150, 150, 150));

		Runnable updateRangeLabel = () -> {
			int lo = slider.getLow();
			int hi = slider.getHigh();
			rangeLabel.setText("From  " + fmt(lo) + "   →   To  " + fmt(hi) + "      (length: " + fmt(hi - lo) + ")");
		};
		
		slider.addChangeListener(() -> {
			updateRangeLabel.run();
			filmstrip.setSelection((double) slider.getLow() / Math.max(1, slider.getMax()),
					(double) slider.getHigh() / Math.max(1, slider.getMax()));
		});

		JButton btnPreview = new JButton("Preview Externally");
		btnPreview.setToolTipText("Open the direct video stream to preview easily");
		btnPreview.addActionListener(e -> {
			new Thread(() -> {
				try {
					String directUrl = MediaProbe.resolveDirectUrl(url);
					if (directUrl != null && !directUrl.isEmpty()) {
						Desktop.getDesktop().browse(new URI(directUrl));
					}
				} catch (Exception ex) {
					ex.printStackTrace();
				}
			}).start();
		});

		JPanel trimBox = new JPanel();
		trimBox.setLayout(new BoxLayout(trimBox, BoxLayout.Y_AXIS));
		trimBox.setBorder(BorderFactory.createEmptyBorder(10, 10, 10, 10));
		filmstrip.setAlignmentX(Component.LEFT_ALIGNMENT);
		slider.setAlignmentX(Component.LEFT_ALIGNMENT);
		rangeLabel.setAlignmentX(Component.LEFT_ALIGNMENT);
		statusLabel.setAlignmentX(Component.LEFT_ALIGNMENT);
		cbPrecise.setAlignmentX(Component.LEFT_ALIGNMENT);
		btnPreview.setAlignmentX(Component.LEFT_ALIGNMENT);
		
		trimBox.add(statusLabel);
		trimBox.add(Box.createVerticalStrut(8));
		trimBox.add(filmstrip);
		trimBox.add(slider);
		trimBox.add(rangeLabel);
		trimBox.add(Box.createVerticalStrut(8));
		trimBox.add(btnPreview);
		trimBox.add(Box.createVerticalStrut(8));
		trimBox.add(cbPrecise);

		loadPreview(url, durationHint, refererUrl, slider, filmstrip, statusLabel, updateRangeLabel, isAudio);

		JScrollPane scrollPane = new JScrollPane(trimBox);
		scrollPane.setBorder(BorderFactory.createEmptyBorder());
		int result = JOptionPane.showConfirmDialog(null, scrollPane, title, JOptionPane.OK_CANCEL_OPTION,
				JOptionPane.PLAIN_MESSAGE);
		
		if (result != JOptionPane.OK_OPTION) {
			return null;
		}

		if (!slider.isEnabled()) {
			return new TrimOptions(null, false);
		}

		int lo = slider.getLow();
		int hi = slider.getHigh();
		if (lo <= 0 && hi >= slider.getMax()) {
			return new TrimOptions(null, false);
		}
		String from = String.valueOf(lo);
		String to = (hi >= slider.getMax()) ? "inf" : String.valueOf(hi);
		return new TrimOptions("*" + from + "-" + to, cbPrecise.isSelected());
	}

	private static void loadPreview(String url, int durationHint, String refererUrl, RangeSlider slider,
			FilmstripPanel filmstrip, JLabel statusLabel, Runnable updateRangeLabel, boolean isAudio) {
		new Thread(() -> {
			int duration = durationHint > 0 ? durationHint : MediaProbe.probeDurationSeconds(url);
			if (duration <= 0) {
				SwingUtilities.invokeLater(() -> statusLabel.setText(
						"Couldn't read the media length — trimming is unavailable for this source."));
				return;
			}
			SwingUtilities.invokeLater(() -> {
				slider.setMax(duration);
				slider.setRange(0, duration);
				slider.setEnabled(true);
				updateRangeLabel.run();
				statusLabel.setText("Drag the two handles to pick the start and end.");
			});

			if (isAudio) {
				SwingUtilities.invokeLater(() -> filmstrip.setAudioMode());
			} else {
				SwingUtilities.invokeLater(() -> statusLabel.setText("Drag the two handles to pick the start and end. Loading preview frames..."));
				String direct = MediaProbe.resolveDirectUrl(url);
				List<BufferedImage> frames = MediaProbe.extractThumbnails(direct, duration, 8, refererUrl);
				SwingUtilities.invokeLater(() -> {
					if (frames.isEmpty()) {
						filmstrip.setUnavailable();
						statusLabel.setText("Drag the two handles to pick the start and end.");
					} else {
						filmstrip.setFrames(frames);
						statusLabel.setText("Drag the two handles to pick the start and end.");
					}
				});
			}
		}, "trim-preview-loader").start();
	}

	private static String fmt(int totalSeconds) {
		if (totalSeconds < 0) totalSeconds = 0;
		int h = totalSeconds / 3600;
		int m = (totalSeconds % 3600) / 60;
		int s = totalSeconds % 60;
		if (h > 0) return String.format("%d:%02d:%02d", h, m, s);
		return String.format("%d:%02d", m, s);
	}

	private static class FilmstripPanel extends JComponent {
		private static final long serialVersionUID = 1L;
		private static final int SIDE_PAD = 10;
		private List<BufferedImage> frames;
		private String placeholder = "";
		private boolean isAudioMode = false;
		private double selLow = 0.0;
		private double selHigh = 1.0;

		FilmstripPanel() {
			setPreferredSize(UIScale.scale(new Dimension(400, 70)));
			setMaximumSize(new Dimension(Integer.MAX_VALUE, UIScale.scale(70)));
		}

		void setFrames(List<BufferedImage> frames) {
			this.frames = frames;
			this.placeholder = "";
			this.isAudioMode = false;
			repaint();
		}

		void setUnavailable() {
			this.frames = null;
			this.placeholder = "(preview not available for this source — the slider still works)";
			this.isAudioMode = false;
			repaint();
		}

		void setAudioMode() {
			this.frames = null;
			this.placeholder = "";
			this.isAudioMode = true;
			repaint();
		}

		void setSelection(double low, double high) {
			this.selLow = low;
			this.selHigh = high;
			repaint();
		}

		@Override
		protected void paintComponent(Graphics g) {
			Graphics2D g2 = (Graphics2D) g.create();
			g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);

			int x0 = SIDE_PAD;
			int w = getWidth() - 2 * SIDE_PAD;
			int h = getHeight() - 8;
			int y = 2;

			g2.setColor(new Color(45, 45, 48));
			g2.fillRect(x0, y, w, h);

			if (isAudioMode) {
				g2.setColor(new Color(66, 133, 244, 180));
				for (int i = 0; i < w; i += 5) {
					double wave = Math.sin(i * 0.1) * 0.5 + Math.cos(i * 0.23) * 0.5;
					int barH = 10 + (int) (Math.abs(wave) * (h - 20));
					g2.fillRect(x0 + i, y + (h - barH) / 2, 3, barH);
				}
			} else if (frames != null && !frames.isEmpty()) {
				int n = frames.size();
				double cellW = (double) w / n;
				for (int i = 0; i < n; i++) {
					BufferedImage img = frames.get(i);
					int cx = x0 + (int) (i * cellW);
					int cw = (int) Math.ceil(cellW);
					if (img != null) {
						g2.drawImage(img, cx, y, cw, h, null);
					}
				}
			} else {
				g2.setColor(new Color(150, 150, 150));
				String text = placeholder.isEmpty() ? "" : placeholder;
				g2.drawString(text, x0 + 8, y + h / 2);
			}

			int selX0 = x0 + (int) (selLow * w);
			int selX1 = x0 + (int) (selHigh * w);
			g2.setColor(new Color(0, 0, 0, 130));
			if (selX0 > x0) g2.fillRect(x0, y, selX0 - x0, h);
			if (selX1 < x0 + w) g2.fillRect(selX1, y, (x0 + w) - selX1, h);
			
			g2.setColor(new Color(66, 133, 244));
			g2.drawLine(selX0, y, selX0, y + h);
			g2.drawLine(selX1, y, selX1, y + h);

			g2.dispose();
		}
	}
}
