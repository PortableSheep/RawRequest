#!/usr/bin/env python3
"""Generate RawRequest app icon - a sleek HTTP/API request icon with arrow motif."""

import struct
import zlib
import os
import math

def create_png(width, height, pixels):
    """Create PNG file from pixel data (RGBA format)."""
    def make_chunk(chunk_type, data):
        chunk_len = struct.pack('>I', len(data))
        chunk_crc = struct.pack('>I', zlib.crc32(chunk_type + data) & 0xffffffff)
        return chunk_len + chunk_type + data + chunk_crc
    
    # PNG signature
    signature = b'\x89PNG\r\n\x1a\n'
    
    # IHDR chunk
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA
    ihdr = make_chunk(b'IHDR', ihdr_data)
    
    # IDAT chunk - compress pixel data with filter bytes
    raw_data = b''
    for y in range(height):
        raw_data += b'\x00'  # Filter type: None
        for x in range(width):
            idx = (y * width + x) * 4
            raw_data += bytes(pixels[idx:idx+4])
    
    compressed = zlib.compress(raw_data, 9)
    idat = make_chunk(b'IDAT', compressed)
    
    # IEND chunk
    iend = make_chunk(b'IEND', b'')
    
    return signature + ihdr + idat + iend

def blend_colors(c1, c2, t):
    """Blend two RGB colors. t=0 returns c1, t=1 returns c2."""
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))

def draw_aa_line(pixels, width, x0, y0, x1, y1, thickness, r, g, b, a):
    """Draw an anti-aliased thick line."""
    dx = x1 - x0
    dy = y1 - y0
    length = math.sqrt(dx * dx + dy * dy)
    if length == 0:
        return
    
    # Expand bounding box
    min_x = max(0, int(min(x0, x1) - thickness - 2))
    max_x = min(width, int(max(x0, x1) + thickness + 2))
    min_y = max(0, int(min(y0, y1) - thickness - 2))
    max_y = min(width, int(max(y0, y1) + thickness + 2))
    
    half_thick = thickness / 2
    
    for py in range(min_y, max_y):
        for px in range(min_x, max_x):
            # Vector from start to pixel
            vx = px - x0
            vy = py - y0
            
            # Project onto line direction
            proj = (vx * dx + vy * dy) / (length * length)
            proj = max(0, min(1, proj))  # Clamp to line segment
            
            # Closest point on line
            closest_x = x0 + proj * dx
            closest_y = y0 + proj * dy
            
            # Distance from pixel to closest point
            dist = math.sqrt((px - closest_x) ** 2 + (py - closest_y) ** 2)
            
            if dist <= half_thick + 1:
                alpha = a
                if dist > half_thick - 1:
                    alpha = int(a * (half_thick + 1 - dist) / 2)
                
                if alpha > 0:
                    idx = (py * width + px) * 4
                    # Alpha blend
                    old_a = pixels[idx + 3]
                    if old_a == 0:
                        pixels[idx:idx+4] = [r, g, b, alpha]
                    else:
                        blend = alpha / 255
                        pixels[idx] = int(pixels[idx] * (1 - blend) + r * blend)
                        pixels[idx+1] = int(pixels[idx+1] * (1 - blend) + g * blend)
                        pixels[idx+2] = int(pixels[idx+2] * (1 - blend) + b * blend)
                        pixels[idx+3] = max(old_a, alpha)

def draw_arrow(pixels, width, cx, cy, length, angle, thickness, head_size, r, g, b, a, direction='right'):
    """Draw an arrow with anti-aliased lines."""
    # Calculate arrow points
    rad = math.radians(angle)
    
    # Arrow shaft
    half_len = length / 2
    x0 = cx - math.cos(rad) * half_len
    y0 = cy - math.sin(rad) * half_len
    x1 = cx + math.cos(rad) * half_len
    y1 = cy + math.sin(rad) * half_len
    
    # Draw shaft
    draw_aa_line(pixels, width, x0, y0, x1, y1, thickness, r, g, b, a)
    
    # Arrow head
    if direction == 'right':
        head_x, head_y = x1, y1
        head_angle = angle + 180
    else:
        head_x, head_y = x0, y0
        head_angle = angle
    
    # Draw arrowhead lines
    for offset in [35, -35]:  # Angles for arrowhead
        head_rad = math.radians(head_angle + offset)
        hx = head_x + math.cos(head_rad) * head_size
        hy = head_y + math.sin(head_rad) * head_size
        draw_aa_line(pixels, width, head_x, head_y, hx, hy, thickness * 0.9, r, g, b, a)

def draw_rounded_rect_outline(pixels, width, x1, y1, x2, y2, radius, thickness, r, g, b, a):
    """Draw a rounded rectangle outline."""
    # Top edge
    draw_aa_line(pixels, width, x1 + radius, y1, x2 - radius, y1, thickness, r, g, b, a)
    # Bottom edge
    draw_aa_line(pixels, width, x1 + radius, y2, x2 - radius, y2, thickness, r, g, b, a)
    # Left edge
    draw_aa_line(pixels, width, x1, y1 + radius, x1, y2 - radius, thickness, r, g, b, a)
    # Right edge
    draw_aa_line(pixels, width, x2, y1 + radius, x2, y2 - radius, thickness, r, g, b, a)
    
    # Draw corners (approximated with short lines)
    steps = 12
    for corner_x, corner_y, start_angle in [
        (x1 + radius, y1 + radius, 180),
        (x2 - radius, y1 + radius, 270),
        (x2 - radius, y2 - radius, 0),
        (x1 + radius, y2 - radius, 90)
    ]:
        for i in range(steps):
            a1 = math.radians(start_angle + i * 90 / steps)
            a2 = math.radians(start_angle + (i + 1) * 90 / steps)
            px1 = corner_x + math.cos(a1) * radius
            py1 = corner_y + math.sin(a1) * radius
            px2 = corner_x + math.cos(a2) * radius
            py2 = corner_y + math.sin(a2) * radius
            draw_aa_line(pixels, width, px1, py1, px2, py2, thickness, r, g, b, a)

def generate_icon(size=1024):
    """Generate a sleek RawRequest app icon."""
    pixels = [0] * (size * size * 4)  # RGBA
    
    center = size // 2
    corner_radius = int(size * 0.22)
    
    # Colors
    bg_top = (15, 23, 42)         # slate-900
    bg_bottom = (30, 41, 59)      # slate-800
    accent_blue = (59, 130, 246)  # blue-500
    accent_cyan = (34, 211, 238)  # cyan-400
    white = (255, 255, 255)
    
    # Draw background with vertical gradient
    for y in range(size):
        for x in range(size):
            t = y / size
            bg = blend_colors(bg_top, bg_bottom, t)
            
            # Check if inside rounded rect
            in_shape = True
            
            # Top-left corner
            if x < corner_radius and y < corner_radius:
                dist = math.sqrt((x - corner_radius) ** 2 + (y - corner_radius) ** 2)
                if dist > corner_radius:
                    in_shape = False
            # Top-right corner
            elif x >= size - corner_radius and y < corner_radius:
                dist = math.sqrt((x - (size - corner_radius)) ** 2 + (y - corner_radius) ** 2)
                if dist > corner_radius:
                    in_shape = False
            # Bottom-left corner
            elif x < corner_radius and y >= size - corner_radius:
                dist = math.sqrt((x - corner_radius) ** 2 + (y - (size - corner_radius)) ** 2)
                if dist > corner_radius:
                    in_shape = False
            # Bottom-right corner
            elif x >= size - corner_radius and y >= size - corner_radius:
                dist = math.sqrt((x - (size - corner_radius)) ** 2 + (y - (size - corner_radius)) ** 2)
                if dist > corner_radius:
                    in_shape = False
            
            idx = (y * size + x) * 4
            if in_shape:
                pixels[idx:idx+4] = [bg[0], bg[1], bg[2], 255]
            else:
                pixels[idx:idx+4] = [0, 0, 0, 0]
    
    # Draw subtle inner glow/border
    border_thickness = size * 0.012
    margin = size * 0.03
    draw_rounded_rect_outline(
        pixels, size,
        margin, margin, size - margin, size - margin,
        corner_radius - margin,
        border_thickness,
        60, 80, 100, 80
    )
    
    # Draw outgoing arrow (request) - top, blue
    arrow_len = size * 0.45
    arrow_thickness = size * 0.045
    arrow_head = size * 0.12
    
    # Request arrow - pointing right, slightly above center
    draw_arrow(
        pixels, size,
        center, center - size * 0.12,
        arrow_len, 0,
        arrow_thickness, arrow_head,
        accent_blue[0], accent_blue[1], accent_blue[2], 255,
        'right'
    )
    
    # Response arrow - pointing left, slightly below center, cyan
    draw_arrow(
        pixels, size,
        center, center + size * 0.12,
        arrow_len, 180,
        arrow_thickness, arrow_head,
        accent_cyan[0], accent_cyan[1], accent_cyan[2], 255,
        'left'
    )
    
    # Add subtle brackets on sides
    bracket_thickness = size * 0.025
    bracket_height = size * 0.35
    bracket_width = size * 0.08
    bracket_margin = size * 0.15
    
    # Left bracket <
    lx = bracket_margin
    ly = center
    # Top arm
    draw_aa_line(pixels, size, lx + bracket_width, ly - bracket_height/2, lx, ly, bracket_thickness, white[0], white[1], white[2], 180)
    # Bottom arm
    draw_aa_line(pixels, size, lx, ly, lx + bracket_width, ly + bracket_height/2, bracket_thickness, white[0], white[1], white[2], 180)
    
    # Right bracket >
    rx = size - bracket_margin
    ry = center
    # Top arm
    draw_aa_line(pixels, size, rx - bracket_width, ry - bracket_height/2, rx, ry, bracket_thickness, white[0], white[1], white[2], 180)
    # Bottom arm
    draw_aa_line(pixels, size, rx, ry, rx - bracket_width, ry + bracket_height/2, bracket_thickness, white[0], white[1], white[2], 180)
    
    return create_png(size, size, pixels)

if __name__ == '__main__':
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_path = os.path.join(script_dir, '..', 'build', 'appicon.png')
    
    print("Generating RawRequest app icon...")
    png_data = generate_icon(1024)
    
    with open(output_path, 'wb') as f:
        f.write(png_data)
    
    print(f"Icon saved to: {output_path}")
