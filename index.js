const { exec } = require('child_process');
const { promisify } = require('util');
const readline = require('readline');

const execAsync = promisify(exec);

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// 상수 관리
const COMPAT_PATH = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers';
const UNINSTALL_LOCATIONS = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
];

/**
 * 1. 스타터 설치 정보 및 경로 확인
 * chcp 65001을 사용하여 한글 검색어 인코딩 문제를 해결합니다.
 */
async function getStarterInfo() {
    for (const rootPath of UNINSTALL_LOCATIONS) {
        try {
            // 한글 검색을 위해 UTF-8 환경(65001) 강제 설정
            const searchCmd = `chcp 65001 > nul && reg query "${rootPath}" /s /f "Daum게임 스타터" /d /reg:64`;
            const { stdout } = await execAsync(searchCmd);

            const lines = stdout.split('\r\n');
            const foundKeyLine = lines.find(line => line.trim().startsWith('HKEY_LOCAL_MACHINE'));

            if (foundKeyLine) {
                const targetKey = foundKeyLine.trim();
                const { stdout: iconStdout } = await execAsync(`chcp 65001 > nul && reg query "${targetKey}" /v "DisplayIcon" /reg:64`);
                const iconMatch = iconStdout.match(/DisplayIcon\s+REG_SZ\s+(.+)/i);

                if (iconMatch) {
                    return {
                        installed: true,
                        iconPath: iconMatch[1].trim().replace(/"/g, '')
                    };
                }
            }
        } catch (e) {
            // 해당 경로에 없으면 다음 루프로 진행
            continue;
        }
    }
    return { installed: false, iconPath: null };
}

/**
 * 2. 현재 설정된 호환성 플래그 확인 (RunAsInvoker 여부)
 */
async function checkPrivilegeSetting(exePath) {
    if (!exePath) return false;
    try {
        // HKCU 영역이므로 관리자 권한 없이 조회 가능
        const { stdout } = await execAsync(`reg query "${COMPAT_PATH}" /v "${exePath}"`);
        return stdout.includes('RunAsInvoker');
    } catch (err) {
        return false;
    }
}

/**
 * 3. 일반 권한 실행 설정 적용
 */
async function applyPrivilege(exePath) {
    try {
        await execAsync(`reg add "${COMPAT_PATH}" /v "${exePath}" /t REG_SZ /d "~ RunAsInvoker" /f`);
        console.log('\n✨ 일반 권한 실행 설정이 완료되었습니다.');
    } catch (err) {
        console.error('\n❌ 설정 실패:', err.message);
    }
    await pause();
}

/**
 * 4. 설정 해제
 */
async function removePrivilege(exePath) {
    try {
        await execAsync(`reg delete "${COMPAT_PATH}" /v "${exePath}" /f`);
        console.log('\n✨ 일반 권한 설정이 해제되었습니다.');
    } catch (err) {
        console.error('\n❌ 해제 실패:', err.message);
    }
    await pause();
}

/**
 * 유틸리티: 화면 일시 정지
 */
function pause() {
    return new Promise(resolve => rl.question('\n엔터를 누르면 메인 화면으로 돌아갑니다...', () => resolve()));
}

/**
 * 메뉴 인터페이스 구성
 */
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

/**
 * 메인 로직 실행
 */
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
                label: '일반 권한 실행 설정 (UAC 건너뛰기)',
                action: async () => { await applyPrivilege(starter.iconPath); return 'continue'; }
            });
        } else {
            menu.push({
                label: '권한 설정 해제 (기본값으로 복구)',
                action: async () => { await removePrivilege(starter.iconPath); return 'continue'; }
            });
        }
        menu.push({ label: '종료', action: () => 'exit' });

        const result = await showMenu(menu);
        if (result === 'exit') break;
    }
    rl.close();
}

startApp();
