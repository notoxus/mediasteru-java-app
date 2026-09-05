package com.mediasteru.view;

import java.awt.Color;
import java.awt.Component;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.RenderingHints;

import javax.swing.JPanel;
import javax.swing.JTable;
import javax.swing.table.TableCellRenderer;

import com.formdev.flatlaf.util.UIScale;

public class ActionButtonsRenderer extends JPanel implements TableCellRenderer {
	private static final long serialVersionUID = 1L;
	private int hoveredRow = -1;
	private int hoveredCol = -1;
	private int hoverX = -1;

	public ActionButtonsRenderer() {
		setOpaque(false);
	}

	public void updateHoverState(int row, int col, int x) {
		this.hoveredRow = row;
		this.hoveredCol = col;
		this.hoverX = x;
	}

	@Override
	public Component getTableCellRendererComponent(JTable table, Object value, boolean isSelected, boolean hasFocus,
			int row, int column) {
		setFont(table.getFont());
		return this;
	}

	private static final Color TRIM_ACCENT = new Color(66, 133, 244);
	private static final Color REMOVE_ACCENT = new Color(220, 53, 69);
	private static final Color IDLE_TEXT = new Color(150, 150, 150);
	@Override
	protected void paintComponent(Graphics g) {
		super.paintComponent(g);
		Graphics2D g2 = (Graphics2D) g.create();
		g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);

		int w = getWidth();
		int h = getHeight();
		int margin = UIScale.scale(6);
		int gap = UIScale.scale(6);
		int btnWidth = (w - 2 * margin - gap) / 2;
		int mid = w / 2;

		boolean isHovered = (hoveredRow >= 0 && hoveredCol >= 0);
		boolean hoverTrim = isHovered && (hoverX >= 0 && hoverX < mid);
		boolean hoverRemove = isHovered && (hoverX >= mid && hoverX <= w);

		g2.setFont(getFont());
		drawFlatButton(g2, margin, btnWidth, h, "Trim", hoverTrim, TRIM_ACCENT);
		drawFlatButton(g2, margin + btnWidth + gap, btnWidth, h, "Remove", hoverRemove, REMOVE_ACCENT);

		g2.dispose();
	}

	/** Pill button: a faint resting outline so it reads as clickable; tint + accent text on hover. */
	private void drawFlatButton(Graphics2D g2, int x, int width, int h, String text, boolean hovered, Color accent) {
		int y = UIScale.scale(4);
		int btnH = h - UIScale.scale(8);
		int arc = UIScale.scale(8);
		if (hovered) {
			g2.setColor(new Color(accent.getRed(), accent.getGreen(), accent.getBlue(), 30));
			g2.fillRoundRect(x, y, width, btnH, arc, arc);
			g2.setColor(accent);
		} else {
			g2.setColor(new Color(0, 0, 0, 18));
		}
		g2.drawRoundRect(x, y, width, btnH, arc, arc);

		g2.setColor(hovered ? accent : IDLE_TEXT);
		int strW = g2.getFontMetrics().stringWidth(text);
		int strH = g2.getFontMetrics().getAscent();
		g2.drawString(text, x + (width - strW) / 2, y + (btnH + strH) / 2 - UIScale.scale(1));
	}
}
