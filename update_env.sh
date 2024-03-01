#!/bin/sh

if [ $# -ne 3 ]; then
  echo -e "Usage: $0 <property_name> <property_value> <file_path>\n"
  echo -e "Adds or replaces the property in the given file."
  exit 1
fi

if [ `grep "^$1=" "$3"` ]; then
  sed -i "s/^$1=.*/$1=$2/" "$3"
else
  echo -e "\n$1=$2" >> "$3"
fi