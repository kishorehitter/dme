import zipfile, struct

apk_path = r'C:\Users\kishore\.gemini\antigravity-cli\brain\35f8a27a-ba67-437f-8da1-ac8211d26b99\scratch\rave_base.apk'
with zipfile.ZipFile(apk_path, 'r') as z:
    dex = z.read('classes11.dex')

string_ids_size, string_ids_off = struct.unpack('<II', dex[56:64])
type_ids_size, type_ids_off = struct.unpack('<II', dex[64:72])
proto_ids_size, proto_ids_off = struct.unpack('<II', dex[72:80])
field_ids_size, field_ids_off = struct.unpack('<II', dex[80:88])
method_ids_size, method_ids_off = struct.unpack('<II', dex[88:96])

def get_string(idx):
    if idx >= string_ids_size: return f'STR_{idx}'
    off = struct.unpack('<I', dex[string_ids_off + idx*4 : string_ids_off + (idx+1)*4])[0]
    p = off
    length = 0
    shift = 0
    while True:
        b = dex[p]
        p += 1
        length |= (b & 0x7f) << shift
        if (b & 0x80) == 0: break
        shift += 7
    end = dex.find(b'\x00', p)
    return dex[p:end].decode('utf-8', 'ignore')

def get_type(idx):
    if idx >= type_ids_size: return f'TYPE_{idx}'
    str_idx = struct.unpack('<I', dex[type_ids_off + idx*4 : type_ids_off + (idx+1)*4])[0]
    return get_string(str_idx)

def get_method(idx):
    if idx >= method_ids_size: return f'METHOD_{idx}'
    class_idx, proto_idx, name_idx = struct.unpack('<HHI', dex[method_ids_off + idx*8 : method_ids_off + (idx+1)*8])
    return get_type(class_idx) + '->' + get_string(name_idx)

def get_field(idx):
    if idx >= field_ids_size: return f'FIELD_{idx}'
    class_idx, type_idx, name_idx = struct.unpack('<HHI', dex[field_ids_off + idx*8 : field_ids_off + (idx+1)*8])
    return get_type(class_idx) + '->' + get_string(name_idx)

def dump(code_off, label):
    regs, ins, outs, tries, debug_off, insns_size = struct.unpack('<HHHHII', dex[code_off:code_off+16])
    insns = dex[code_off+16 : code_off+16+insns_size*2]
    print(f'=== {label} ===')
    p = 0
    while p < len(insns):
        op = insns[p]
        info = f'{p:04x}: op={op:02x}'
        if op == 0x1a:
            s_idx = struct.unpack('<H', insns[p+2:p+4])[0]
            info += f' const-string \"{get_string(s_idx)}\"'
            p += 4
        elif op == 0x1b:
            s_idx = struct.unpack('<I', insns[p+2:p+6])[0]
            info += f' const-string/jumbo \"{get_string(s_idx)}\"'
            p += 6
        elif op in [0x6e, 0x6f, 0x70, 0x71, 0x72]:
            m_idx = struct.unpack('<H', insns[p+2:p+4])[0]
            info += f' invoke {get_method(m_idx)}'
            p += 6
        elif op in [0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58]:
            f_idx = struct.unpack('<H', insns[p+2:p+4])[0]
            info += f' iget {get_field(f_idx)}'
            p += 4
        elif op in [0x59, 0x5a, 0x5b, 0x5c, 0x5d, 0x5e, 0x5f]:
            f_idx = struct.unpack('<H', insns[p+2:p+4])[0]
            info += f' iput {get_field(f_idx)}'
            p += 4
        elif op in [0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66]:
            f_idx = struct.unpack('<H', insns[p+2:p+4])[0]
            info += f' sget {get_field(f_idx)}'
            p += 4
        else:
            p += 2
        print('  ', info)

dump(5290112, 'buildRangeParameter')
