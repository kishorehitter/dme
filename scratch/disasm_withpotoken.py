import zipfile
import struct

apk_path = r"C:\Users\kishore\.gemini\antigravity-cli\brain\35f8a27a-ba67-437f-8da1-ac8211d26b99\scratch\rave_base.apk"
with zipfile.ZipFile(apk_path, 'r') as z:
    dex_bytes = z.read('classes11.dex')

fields = struct.unpack_from('<8sI20s20I', dex_bytes, 0)
string_ids_off = fields[10]
type_ids_off = fields[12]
method_ids_off = fields[18]

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

# withPoToken code_off: 5380996
code_off = 5380996
registers_size, ins_size, outs_size, tries_size, debug_info_off, insns_size = struct.unpack_from('<HHHHII', dex_bytes, code_off)
print(f"withPoToken: insns_size={insns_size}, registers={registers_size}, ins_size={ins_size}")
insns = dex_bytes[code_off + 16: code_off + 16 + insns_size * 2]

# Dump opcodes and called methods
i = 0
while i < len(insns):
    op = insns[i]
    if op in [0x6e, 0x74, 0x6f, 0x70, 0x71, 0x72]: # invoke-virtual, invoke-direct, invoke-static, etc.
        meth_idx = struct.unpack_from('<H', insns, i + 2)[0]
        m_cls, m_name = get_method_name(meth_idx)
        print(f"  [{i}] invoke: {m_cls}->{m_name}")
        i += 6
    elif op in [0x1a]: # const-string
        str_idx = struct.unpack_from('<H', insns, i + 2)[0]
        print(f"  [{i}] const-string: {get_string(str_idx)}")
        i += 4
    elif op in [0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19]: # const/4 etc
        i += 2
    elif op in [0x0e, 0x0f, 0x10, 0x11]: # return
        print(f"  [{i}] return")
        i += 2
    else:
        i += 2
