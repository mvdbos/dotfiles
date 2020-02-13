# exit when any command fails
set -e

# keep track of the last executed command
trap 'last_command=$current_command; current_command=$BASH_COMMAND' DEBUG
# echo an error message before exiting
function handle_error() {
    exit_code=$?
    if [[ $exit_code != 0 ]]; then
        echo -e "\n$(basename ${0}): \"${last_command}\" command failed with exit code ${exit_code}." >&2
    fi
}
trap handle_error EXIT


