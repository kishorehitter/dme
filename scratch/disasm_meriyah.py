import zipfile
import struct

apk_path = r"C:\Users\kishore\.gemini\antigravity-cli\brain\35f8a27a-ba67-437f-8da1-ac8211d26b99\scratch\rave_base.apk"
with zipfile.ZipFile(apk_path, 'r') as z:
    dex_bytes = z.read('classes11.dex')

fields = struct.unpack_from('<8sI20s20I', dex_bytes, 0)
string_ids_off = fields[10]
type_ids_off = fields[12]
method_ids_off = fields[18]
class_defs_size = fields[19]
class_defs_off = fields[20]

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

for i in range(class_defs_size):
    class_idx, access_flags, superclass_idx, interfaces_off, source_file_idx, \
    annotations_off, class_data_off, static_values_off = struct.unpack_from('<IIIIIIII', dex_bytes, class_defs_off + i * 32)
    cname = get_type(class_idx)
    if cname == 'Lcom/wemesh/android/legacy/utils/youtube/decrypt/MeriyahEngine;':
        print(f"Class: {cname}")
        off = class_data_off
        num_sf, off = read_uleb128(dex_bytes, off)
        num_if, off = read_uleb128(dex_bytes, off)
        num_dm, off = read_uleb128(dex_bytes, off)
        num_vm, off = read_uleb128(dex_bytes, off)
        
        for _ in range(num_sf + num_if):
            _, off = read_uleb128(dex_bytes, off)
            _, off = read_uleb128(dex_bytes, off)
            
        m_idx = 0
        for _ in range(num_dm):
            diff, off = read_uleb128(dex_bytes, off)
            m_idx += diff
            m_flags, off = read_uleb128(dex_bytes, off)
            code_off, off = read_uleb128(dex_bytes, off)
            m_class, m_name = get_method_name(m_idx)
            if m_name == 'withPoToken' or m_name == 'runDecipher' or m_name == 'decipherBatch':
                print(f"Direct Method: {m_name}, code_off: {code_off}")
                # Dump bytecode bytes
                if code_off > 0:
                    registers_size, ins_size, outs_size, tries_size, debug_info_off, insns_size = struct.unpack_from('<HHHHII', dex_bytes, code_off)
                    insns = dex_bytes[code_off + 16: code_off + 16 + insns_size * 2]
                    print(f"  insns_size: {insns_size}, registers: {registers_size}")
                    # Search strings in instructions (const-string opcodes 0x1a, 0x1b)
                    for j in range(0, len(insns) - 2, 2):
                        op = insns[j]
                        if op == 0x1a: # const-string
                            str_id = struct.unpack_from('<H', insns, j + 2)[0]
                            print(f"    const-string: {get_string(str_id)}")
                        elif op == 0x1b: # const-string/jumbo
                            str_id = struct.unpack_from('<I', insns, j + 2)[0]
                            print(f"    const-string/jumbo: {get_string(str_id)}")
                            
        m_idx = 0
        for _ in range(num_vm):
            diff, off = read_uleb128(dex_bytes, off)
            m_idx += diff
            m_flags, off = read_uleb128(dex_bytes, off)
            code_off, off = read_uleb128(dex_bytes, off)
            m_class, m_name = get_method_name(m_idx)
            if m_name == 'withPoToken' or m_name == 'runDecipher' or m_name == 'decipherBatch':
                print(f"Virtual Method: {m_name}, code_off: {code_off}")
                if code_off > 0:
                    registers_size, ins_size, outs_size, tries_size, debug_info_off, insns_size = struct.unpack_from('<HHHHII', dex_bytes, code_off)
                    insns = dex_bytes[code_off + 16: code_off + 16 + insns_size * 2]
                    print(f"  insns_size: {insns_size}, registers: {registers_size}")
                    for j in range(0, len(insns) - 2, 2):
                        op = insns[j]
                        if op == 0x1a:
                            str_id = struct.unpack_from('<H', insns, j + 2)[0]
                            print(f"    const-string: {get_string(str_id)}")
                        elif op == 0x1b:
                            str_id = struct.unpack_from('<I', insns, j + 2)[0]
                            print(f"    const-string/jumbo: {get_string(str_id)}")
