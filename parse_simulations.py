# -*- coding: utf-8 -*-
"""
Created on Sun Nov 13 15:43:36 2022

@author: Mohammed Haddouti
"""

from os import listdir, getcwd
from os.path import isfile, join
import shutil
import pandas as pd

excel_path = join(getcwd(), "test", "Simulation_template.xlsx")
sim_path = join(getcwd(), "test", "simulations")
print(sim_path)



def processCSVs(from_path):
    
    csvs = []
    for f in listdir(from_path):
        if isfile(join(from_path, f)):
            if f.endswith(".csv"):
                csvs.append(f)
        else:
            processCSVs(join(from_path, f))
        
    i = 0
    for f in csvs:
        try:
            name = ""
            if "_gasLog" in f:
                continue
            else:
                name = f.replace(".csv", ".xlsx")
                sheet_name = "Data"
            print(i, "of", int(len(csvs) / 2), "-", f)
            csv = join(from_path, f)
            df = pd.read_csv(csv, sep=";", header=None)
            
            target_path = join(from_path, name)
            shutil.copyfile(excel_path, target_path)
        
            with pd.ExcelWriter(target_path,
                                mode="a", if_sheet_exists="overlay") as writer:  
                df.to_excel(writer, sheet_name=sheet_name, header=False, index=False)

        except:
            print("Skipping", f)

        i += 1

    i = 0
    for f in csvs:
        try:
            name = ""
            if "_gasLog" in f:
                name = f.replace("_gasLog.csv", ".xlsx")
                sheet_name = "GasData"
            else:
                continue
            print(i, "of", int(len(csvs) / 2), "-", f)
            csv = join(from_path, f)
            df = pd.read_csv(csv, sep=";", header=None)
            
            target_path = join(from_path, name)
        
            with pd.ExcelWriter(target_path,
                                mode="a", if_sheet_exists="overlay") as writer:  
                df.to_excel(writer, sheet_name=sheet_name, header=False, index=False)

        except:
            print("Skipping", f)

        i += 1
                     
processCSVs(sim_path)