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
    if 'InnertubeClient$Key$Companion;' in cname or 'priorityOrder' in cname:
        off = class_data_off
        num_sf, off = read_uleb128(dex_bytes, off)
        num_if, off = read_uleb128(dex_bytes, off)
        num_dm, off = read_uleb128(dex_bytes, off)
        num_vm, off = read_uleb128(dex_bytes, off)
        for _ in range(num_sf + num_if):
            _, off = read_uleb128(dex_bytes, off)
            _, off = read_uleb128(dex_bytes, off)
        all_methods = []
        m_idx = 0
        for _ in range(num_dm):
            diff, off = read_uleb128(dex_bytes, off)
            m_idx += diff
            m_flags, off = read_uleb128(dex_bytes, off)
            code_off, off = read_uleb128(dex_bytes, off)
            all_methods.append((m_idx, code_off))
        m_idx = 0
        for _ in range(num_vm):
            diff, off = read_uleb128(dex_bytes, off)
            m_idx += diff
            m_flags, off = read_uleb128(dex_bytes, off)
            code_off, off = read_uleb128(dex_bytes, off)
            all_methods.append((m_idx, code_off))
        for m_idx, code_off in all_methods:
            mc, mn = get_method_name(m_idx)
            if mn == 'priorityOrder':
                print(f"{cname}->{mn} (code_off: {code_off})")
                reg_sz, ins_sz, outs_sz, tries_sz, dbg_off, insns_sz = struct.unpack_from('<HHHHII', dex_bytes, code_off)
                insns = dex_bytes[code_off + 16: code_off + 16 + insns_sz * 2]
                k = 0
                while k < len(insns):
                    op = insns[k]
                    if op in [0x1a]:
                        str_id = struct.unpack_from('<H', insns, k + 2)[0]
                        try:
                            s = get_string(str_id)
                            print(f"    const-string: {s}")
                        except: pass
                        k += 4
                    elif op in [0x6e, 0x6f, 0x70, 0x71, 0x72, 0x74, 0x75, 0x76, 0x77, 0x78]:
                        meth_idx = struct.unpack_from('<H', insns, k + 2)[0]
                        try:
                            mc2, mn2 = get_method_name(meth_idx)
                            print(f"    invoke: {mc2}->{mn2}")
                        except: pass
                        k += 6
                    elif op in [0x62, 0x63]: # sget-object
                        field_idx = struct.unpack_from('<H', insns, k + 2)[0]
                        print(f"    sget-object field_idx: {field_idx}")
                        k += 4
                    else:
                        k += 2
