const fs = require('fs');
global.window = global;
const path = require('path');
global.meriyah = require(path.resolve(__dirname, '../DME/android/app/src/main/assets/meriyah.umd.min.js'));
let extractorCode = fs.readFileSync(path.resolve(__dirname, '../DME/android/app/src/main/assets/youtubejs.extractor.js'), 'utf8');
extractorCode = extractorCode.replace('(new Function(fullCode))();', 'fs.writeFileSync("./scratch/fullCode.js", fullCode); (new Function(fullCode))();');
eval(extractorCode);

(async () => {
    const pUrl = 'https://www.youtube.com/s/player/5203c085/player-plasma-es6-en_US.vflset/base.js';
    const playerJs = await fetch(pUrl).then(r => r.text());
    global.document = { createElement: () => ({ pathname: '', search: '', href: '' }), head: {}, body: {} };
    global.location = { href: 'https://www.youtube.com/watch?v=AAq06bS8UZM', hostname: 'www.youtube.com', search: '?v=AAq06bS8UZM' };
    global.XMLHttpRequest = class { open() {} send() {} };
    global.window = global;
    try {
        global.YT_PREPROCESS.preprocessAndEval(playerJs);
        console.log('preprocessAndEval succeeded!');
        
        const testItem = [{
            itag: 137,
            url: null,
            rawUrl: 'https://rr3---sn-8vq54voxpo-nm8z.googlevideo.com/videoplayback?...',
            n: 'RiLEYvi52NnJi-BR9qqs',
            sig: null,
            isCipher: false,
            sp: 'sig',
        }];
        const decipherResultStr = global.YT_PREPROCESS.decipher(JSON.stringify(testItem));
        console.log('Decipher result:', decipherResultStr);
        const dec = JSON.parse(decipherResultStr)[0];
        console.log('Transformed newN:', dec.newN);

        const baseUrl = 'https://rr3---sn-8vq54voxpo-nm8z.googlevideo.com/videoplayback?expire=1791754216&ei=iKvLarLMK6fG1_oPptnO0QM&ip=2402%3A3a80%3A41%3A5853%3Af8c0%3Ade94%3A70c4%3A5cc5&id=o-AB8qbEQ4cHGQnpcL2ms-XMOudh2qBv6omy04QU-krjB-&itag=137&aitags=133%2C134%2C135%2C136%2C137%2C160%2C242%2C243%2C244%2C247%2C248%2C271%2C278%2C313%2C394%2C395%2C396%2C397%2C398%2C399%2C400%2C401%2C598&source=youtube&requiressl=yes&xpc=EgVo2aDSNQ%3D%3D&cps=876&met=1791732616%2C&mh=gD&mm=18%2C29&mn=sn-8vq54voxpo-nm8z%2Csn-h5576nsd&ms=aub%2Crdu&mv=m&mvi=3&pl=48&rms=aub%2Caub&initcwndbps=258625&bui=AWzQHwphZi7e8_Fn56m3GCL-VHoxbNur0WTfgNLL2tMMWeTb1r9kUS_Q-jLeGgHLO6Cf99fNhqseWv2e&spc=I-rgIWZWdY5gANPK69OLAhPAF7YaZftOhR1VGo0M7wluYJmtx9tOtdOyIyVCJ_aqzlWLceuNVfZgfA&vprv=1&svpuc=1&mime=video%2Fmp4&ns=nAfYFAzSVRCiuMhNdJYotS0Z&rqh=1&gir=yes&clen=88806866&dur=230.874&lmt=1788010957330650&mt=1791732086&fvip=4&keepalive=yes&fexp=51565115%2C52112905%2C52184232%2C52250513&c=MWEB&sefc=1&txp=5532234&n=RiLEYvi52NnJi-BR9qqs&sparams=expire%2Cei%2Cip%2Cid%2Caitags%2Csource%2Crequiressl%2Cxpc%2Cbui%2Cspc%2Cvprv%2Csvpuc%2Cmime%2Cns%2Crqh%2Cgir%2Cclen%2Cdur%2Clmt&sig=AE0s2JYwRQIhANw-yXXJ9JkgRtBVsOj2DYy67SBPrD_ZVxckHBmRfhQKAiAUluxpG0mmheGunRKN5xRiHjky-6O2Mcpt6KOVfSLl0Q%3D%3D&lsparams=cps%2Cmet%2Cmh%2Cmm%2Cmn%2Cms%2Cmv%2Cmvi%2Cpl%2Crms%2Cinitcwndbps&lsig=APaTxxMwRQIgcGUFrlZpgkeJg7Xyj3adgAI6mb_O0mzDhy3ru8kB4lUCIQDqLt_JyPQh_czp5vpmKUIe7RTGLFy4YlSj4OqlbvihyA%3D%3D';

        const transformedUrl = baseUrl.replace(/([?&])n=[^&]+/, `$1n=${encodeURIComponent(dec.newN)}`);
        
        console.log('Testing GVS request with transformed newN at byte 0-1000...');
        const r0 = await fetch(transformedUrl, {
            headers: {
                'Range': 'bytes=0-1000',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36',
                'Origin': 'https://m.youtube.com',
                'Referer': 'https://m.youtube.com/'
            }
        });
        console.log('Byte 0-1000 HTTP Status:', r0.status);

        console.log('Testing GVS request with transformed newN at byte 25000000-25001000 (past 60s)...');
        const r60 = await fetch(transformedUrl, {
            headers: {
                'Range': 'bytes=25000000-25001000',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36',
                'Origin': 'https://m.youtube.com',
                'Referer': 'https://m.youtube.com/'
            }
        });
        console.log('Byte 25MB (past 60s) HTTP Status:', r60.status);
    } catch(e) {
        console.log('Error caught:', e.message);
        if (fs.existsSync('./scratch/fullCode.js')) {
            const lines = fs.readFileSync('./scratch/fullCode.js', 'utf8').split('\n');
            console.log('Total lines:', lines.length);
            for (let i = Math.max(0, 5055); i < Math.min(lines.length, 5075); i++) {
                console.log((i+1) + ': ' + lines[i]);
            }
        }
    }
})();
