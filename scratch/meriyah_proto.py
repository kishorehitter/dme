import zipfile
import struct

apk_path = r"C:\Users\kishore\.gemini\antigravity-cli\brain\35f8a27a-ba67-437f-8da1-ac8211d26b99\scratch\rave_base.apk"
with zipfile.ZipFile(apk_path, 'r') as z:
    dex_bytes = z.read('classes11.dex')

fields = struct.unpack_from('<8sI20s20I', dex_bytes, 0)
string_ids_off = fields[10]
type_ids_off = fields[12]
proto_ids_off = fields[14]
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

def get_proto(idx):
    shorty_idx, return_type_idx, parameters_off = struct.unpack_from('<III', dex_bytes, proto_ids_off + idx * 12)
    ret = get_type(return_type_idx)
    params = []
    if parameters_off != 0:
        size = struct.unpack_from('<I', dex_bytes, parameters_off)[0]
        for p in range(size):
            type_idx = struct.unpack_from('<H', dex_bytes, parameters_off + 4 + p * 2)[0]
            params.append(get_type(type_idx))
    return f"({','.join(params)}){ret}"

def get_method_name(idx):
    class_idx, proto_idx, name_idx = struct.unpack_from('<HHI', dex_bytes, method_ids_off + idx * 8)
    return get_type(class_idx), get_string(name_idx), get_proto(proto_idx)

for i in range(method_ids_size):
    c, m, proto = get_method_name(i)
    if 'MeriyahEngine' in c and (m in ['decipherBatch', 'withPoToken', 'decipherSingle']):
        print(f"{c}->{m}: {proto}")
