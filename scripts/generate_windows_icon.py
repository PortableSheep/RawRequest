#!/usr/bin/env python3
"""
Generate Windows .ico file from appicon.png
Requires: pip install Pillow
"""

from PIL import Image
import os

def generate_ico():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    
    source = os.path.join(project_root, "build", "appicon.png")
    output = os.path.join(project_root, "build", "windows", "icon.ico")
    
    if not os.path.exists(source):
        print(f"Error: {source} not found")
        return
    
    # Open the source image
    img = Image.open(source)
    
    # Ensure it has an alpha channel
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    
    # ICO sizes (Windows standard)
    sizes = [16, 24, 32, 48, 64, 128, 256]
    
    # Create resized versions
    icons = []
    for size in sizes:
        resized = img.resize((size, size), Image.Resampling.LANCZOS)
        icons.append(resized)
    
    # Save as ICO
    os.makedirs(os.path.dirname(output), exist_ok=True)
    icons[0].save(
        output,
        format='ICO',
        sizes=[(s, s) for s in sizes],
        append_images=icons[1:]
    )
    
    print(f"Generated: {output}")
    print(f"Sizes: {sizes}")

if __name__ == "__main__":
    generate_ico()
