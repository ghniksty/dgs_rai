const { exec } = require('child_process');
const { promisify } = require('util');
const readline = require('readline');

const execAsync = promisify(exec);
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const UNINSTALL_PATH = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
const COMPAT_PATH = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers';

// 1. 스타터 설치 정보 확인 (reg query 사용)
async function getStarterInfo() {
    try {
        // 1. Uninstall 경로 하위의 모든 서브키 목록을 가져옵니다.
        const { stdout: keysStdout } = await execAsync(`reg query "${UNINSTALL_PATH}"`);
        const keys = keysStdout.split('\r\n').filter(line => line.trim().startsWith('HKEY_LOCAL_MACHINE'));

        for (const key of keys) {
            try {
                // 2. 각 서브키의 DisplayName 값을 확인합니다.
                const { stdout: detailStdout } = await execAsync(`reg query "${key}" /v "DisplayName"`);
                
                // 정확히 "Daum게임 스타터"인지 확인
                if (detailStdout.includes('Daum게임 스타터')) {
                    // 3. 일치한다면 DisplayIcon 값을 가져옵니다.
                    const { stdout: iconStdout } = await execAsync(`reg query "${key}" /v "DisplayIcon"`);
                    const iconMatch = iconStdout.match(/DisplayIcon\s+REG_SZ\s+(.+)/i);
                    
                    return {
                        installed: true,
                        iconPath: iconMatch ? iconMatch[1].trim().replace(/"/g, '') : null // 따옴표 제거
                    };
                }
            } catch (e) {
                // DisplayName이 없는 키는 건너뜁니다.
                continue;
            }
        }
    } catch (err) {
        console.error('설치 정보 확인 중 오류:', err.message);
    }
    return { installed: false, iconPath: null };
}

// 2. 일반 권한 설정 여부 확인
async function checkPrivilegeSetting(exePath) {
    if (!exePath) return false;
    try {
        const { stdout } = await execAsync(`reg query "${COMPAT_PATH}" /v "${exePath}"`);
        return stdout.includes('RunAsInvoker');
    } catch (err) {
        return false;
    }
}

// 3. 설정 적용 (reg add)
async function applyPrivilege(exePath) {
    try {
        // /t REG_SZ: 타입 지정, /d: 데이터, /f: 강제 덮어쓰기
        await execAsync(`reg add "${COMPAT_PATH}" /v "${exePath}" /t REG_SZ /d "~ RunAsInvoker" /f`);
        console.log('\n✨ 일반 권한 실행 설정이 완료되었습니다.');
    } catch (err) {
        console.error('\n❌ 설정 실패 (관리자 권한 필요):', err.message);
    }
    await pause();
}

// 4. 설정 해제 (reg delete)
async function removePrivilege(exePath) {
    try {
        // /v: 특정 값만 삭제, /f: 확인 없이 강제 삭제
        await execAsync(`reg delete "${COMPAT_PATH}" /v "${exePath}" /f`);
        console.log('\n✨ 일반 권한 설정이 해제되었습니다.');
    } catch (err) {
        console.error('\n❌ 해제 실패:', err.message);
    }
    await pause();
}

function pause() {
    return new Promise(resolve => rl.question('\n엔터를 누르면 메인 화면으로 돌아갑니다...', () => resolve()));
}

async function startApp() {
    while (true) {
        console.clear();
        console.log('======================================');
        console.log('      Daum게임 스타터 권한 관리기      ');
        console.log('======================================\n');

        const starter = await getStarterInfo();
        console.log(`- 설치 여부: ${starter.installed ? '✅ 설치됨' : '❌ 미설치'}`);

        if (!starter.installed) {
            console.log('\n"Daum게임 스타터"를 찾을 수 없습니다.');
            const result = await showMenu([{ label: '종료', action: () => 'exit' }]);
            if (result === 'exit') break;
            continue;
        }

        const isSet = await checkPrivilegeSetting(starter.iconPath);
        console.log(`- 일반 권한 실행 설정: ${isSet ? '✅ 설정됨' : '❌ 미설정'}`);

        const menu = [];
        if (!isSet) {
            menu.push({
                label: '일반 권한 실행 설정',
                action: async () => { await applyPrivilege(starter.iconPath); return 'continue'; }
            });
        } else {
            menu.push({
                label: '권한 설정 해제',
                action: async () => { await removePrivilege(starter.iconPath); return 'continue'; }
            });
        }
        menu.push({ label: '종료', action: () => 'exit' });

        const result = await showMenu(menu);
        if (result === 'exit') break;
    }
    rl.close();
}

function showMenu(options) {
    return new Promise((resolve) => {
        console.log('\n[ 메뉴 ]');
        options.forEach((opt, idx) => console.log(`${idx + 1}. ${opt.label}`));
        rl.question('\n선택: ', async (answer) => {
            const index = parseInt(answer) - 1;
            const choice = options[index];
            if (choice) resolve(await choice.action());
            else {
                console.log('잘못된 선택입니다.');
                setTimeout(() => resolve('continue'), 1000);
            }
        });
    });
}

startApp();