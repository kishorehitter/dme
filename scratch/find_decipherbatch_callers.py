import zipfile
import struct

apk_path = r"C:\Users\kishore\.gemini\antigravity-cli\brain\35f8a27a-ba67-437f-8da1-ac8211d26b99\scratch\rave_base.apk"
with zipfile.ZipFile(apk_path, 'r') as z:
    dex_bytes = z.read('classes11.dex')

fields = struct.unpack_from('<8sI20s20I', dex_bytes, 0)
string_ids_off = fields[10]
type_ids_off = fields[12]
method_ids_off = fields[18]
method_ids_size = fields[17]

def read_uleb128(data, off):
    res = 0
    shift = 0
    while True:
        b = data[off]
        off += 1
        res |= (b & 0x7f) << shift
        if (b & 0x80) == 0:
            break
        shift += 7
    return res, off

def get_string(idx):
    off = struct.unpack_from('<I', dex_bytes, string_ids_off + idx * 4)[0]
    utf16_len, off = read_uleb128(dex_bytes, off)
    end = dex_bytes.find(b'\x00', off)
    return dex_bytes[off:end].decode('utf-8', errors='ignore')

def get_type(idx):
    str_idx = struct.unpack_from('<I', dex_bytes, type_ids_off + idx * 4)[0]
    return get_string(str_idx)

def get_method_name(idx):
    class_idx, proto_idx, name_idx = struct.unpack_from('<HHI', dex_bytes, method_ids_off + idx * 8)
    return get_type(class_idx), get_string(name_idx)

# Find decipherBatch method idx
db_idx = None
for i in range(method_ids_size):
    c, m = get_method_name(i)
    if 'MeriyahEngine' in c and m == 'decipherBatch':
        print(f"decipherBatch at method_idx: {i} ({c}->{m})")
        db_idx = i
        break

db_bytes = struct.pack('<H', db_idx)
idx = 0
while True:
    idx = dex_bytes.find(db_bytes, idx)
    if idx == -1: break
    op = dex_bytes[idx - 2]
    if op in [0x6e, 0x74, 0x6f, 0x70, 0x71, 0x72]:
        print(f"decipherBatch invoked at offset {idx - 2} (op 0x{op:02x})")
    idx += 2
