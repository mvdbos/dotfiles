PLATFORM_NAME=""
PLATFORM_IS_LINUX=0
PLATFORM_IS_UBUNTU=0
PLATFORM_IS_ANDROID=0
PLATFORM_IS_DARWIN=0

function __uname_contains() {
    uname -a | grep -isq "$1"
}

function detect_platform() {

    if __uname_contains "Darwin" ; then
        PLATFORM_NAME="Darwin"
        PLATFORM_IS_DARWIN=1
    elif  __uname_contains "Linux" ; then
        PLATFORM_IS_LINUX=1

        if __uname_contains "Ubuntu" ; then
            PLATFORM_NAME="Ubuntu"
            PLATFORM_IS_UBUNTU=1
        elif  __uname_contains "Android" ; then
            PLATFORM_NAME="Android"
            PLATFORM_IS_ANDROID=1
        else
            echo "Unknown Linux: ${uname}"
            return 1
        fi

    else
            echo "Unknown platform: ${uname}"
        return 1
    fi

    return 0
}
