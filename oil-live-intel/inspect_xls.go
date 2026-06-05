package main

import (
	"fmt"
	"net/http"
	"os"
	"io"
	"github.com/xuri/excelize/v2"
)

func main() {
	resp, err := http.Get("https://www.eia.gov/petroleum/refinerycapacity/refcap25.xlsx")
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()

	out, err := os.Create("refcap25.xlsx")
	if err != nil {
		panic(err)
	}
	defer out.Close()
	io.Copy(out, resp.Body)

	f, err := excelize.OpenFile("refcap25.xlsx")
	if err != nil {
		panic(err)
	}
	defer f.Close()

	for _, name := range f.GetSheetList() {
		fmt.Println("Sheet:", name)
		if name == "refcap25" {
			rows, _ := f.GetRows(name)
			for i := 0; i < 15 && i < len(rows); i++ {
				fmt.Printf("Row %d: %v\n", i, rows[i])
			}
		}
	}
}
