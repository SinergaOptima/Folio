import struct
import zlib
import os

def make_png(path):
    width = height = 1
    raw_data = b'\x00' + b'\xff\x00\x00\xff' # Red pixel
    idat_data = zlib.compress(raw_data)
    
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        
        ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
        f.write(struct.pack('>I', len(ihdr_data)))
        f.write(b'IHDR')
        f.write(ihdr_data)
        f.write(struct.pack('>I', zlib.crc32(b'IHDR' + ihdr_data) & 0xffffffff))
        
        f.write(struct.pack('>I', len(idat_data)))
        f.write(b'IDAT')
        f.write(idat_data)
        f.write(struct.pack('>I', zlib.crc32(b'IDAT' + idat_data) & 0xffffffff))
        
        f.write(struct.pack('>I', 0))
        f.write(b'IEND')
        f.write(struct.pack('>I', zlib.crc32(b'IEND') & 0xffffffff))

os.makedirs('src-tauri/icons', exist_ok=True)
make_png('src-tauri/icons/icon.png')
for name in ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.icns', 'icon.ico']:
    with open(f'src-tauri/icons/{name}', 'wb') as f:
        with open('src-tauri/icons/icon.png', 'rb') as src:
            f.write(src.read())
